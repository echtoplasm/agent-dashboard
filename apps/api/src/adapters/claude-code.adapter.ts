/**
 * Adapter for Claude Code, run as `claude --print --output-format stream-json`.
 *
 * Verified against Claude Code 2.1.291 in the sandbox image:
 *
 * - `stream-json` requires `--verbose` in print mode, and prints one JSON
 *   object per line: a `system`/`init` line, then `assistant` and `user`
 *   lines (one content block each), optional `rate_limit_event` lines, and a
 *   final `result` line with token totals and `total_cost_usd`.
 * - A failed run still ends with a `result` line, with `is_error: true`.
 * - `--bare` is not used: it limits the tools to Bash, Edit and Read and
 *   skips user skills. Isolation comes from the sandbox's empty HOME instead.
 * - Skills are discovered from `$CLAUDE_CONFIG_DIR/skills/<name>/SKILL.md`.
 * - Permission prompts are bypassed because nobody can answer them in a
 *   headless run; the container is the security boundary (D-024).
 */
import { MICRO_USD_PER_USD } from '@agent-dashboard/shared';
import type { AgentAdapter, AgentOutputParser, ParsedProviderEvent } from './agent-adapter.js';
import {
  createProviderOtherEvent,
  createUnparseableLineEvent,
  isJsonObject,
  limitText,
  limitToolOutput,
  parseJsonObjectLine,
  readArray,
  readCount,
  readNumber,
  readObject,
  readString,
  readStringArray,
  toIsoFromEpochSeconds,
} from './adapter-helpers.js';
import type { JsonObject } from './adapter-helpers.js';

/** Where Claude Code looks for skills inside the sandbox image. */
const CLAUDE_SKILLS_DIRECTORY = '/home/agent/.claude/skills';

const CLAUDE_BASE_COMMAND = [
  'claude',
  '--print',
  '--output-format',
  'stream-json',
  '--verbose',
  '--no-session-persistence',
  '--permission-mode',
  'bypassPermissions',
];

/** Top-level `type` values in Claude Code's stream-json output. */
const CLAUDE_EVENT_TYPES = {
  SYSTEM: 'system',
  ASSISTANT: 'assistant',
  USER: 'user',
  RATE_LIMIT: 'rate_limit_event',
  RESULT: 'result',
} as const;

const SYSTEM_SUBTYPES = { INIT: 'init', API_RETRY: 'api_retry' } as const;

const CONTENT_BLOCK_TYPES = {
  TEXT: 'text',
  THINKING: 'thinking',
  TOOL_USE: 'tool_use',
  TOOL_RESULT: 'tool_result',
} as const;

const SUCCESS_RESULT_SUBTYPE = 'success';

/** Builds a parsed event that carries the provider's raw JSON. */
function withRawPayload(
  event: ParsedProviderEvent['event'],
  rawPayload: JsonObject | null,
): ParsedProviderEvent {
  return { event, rawPayload, occurredAt: null };
}

/**
 * Attaches the raw line to the first event only, so a line that becomes
 * several events isn't stored several times.
 */
function attachRawPayloadToFirst(
  events: ParsedProviderEvent['event'][],
  rawPayload: JsonObject,
): ParsedProviderEvent[] {
  return events.map((event, index) => withRawPayload(event, index === 0 ? rawPayload : null));
}

function parseSystemLine(line: JsonObject): ParsedProviderEvent[] {
  const subtype = readString(line, 'subtype');
  if (subtype === SYSTEM_SUBTYPES.INIT) {
    return [
      withRawPayload(
        {
          type: 'session.started',
          payload: {
            providerSessionId: readString(line, 'session_id'),
            model: readString(line, 'model'),
            tools: readStringArray(line, 'tools'),
            skills: readStringArray(line, 'skills'),
          },
        },
        line,
      ),
    ];
  }
  if (subtype === SYSTEM_SUBTYPES.API_RETRY) {
    const attempt = readNumber(line, 'attempt');
    const maxRetries = readNumber(line, 'max_retries');
    const reason = readString(line, 'error') ?? 'unknown error';
    return [
      withRawPayload(
        {
          type: 'notice',
          payload: {
            message: `API request failed (${reason}); retry ${attempt ?? '?'} of ${maxRetries ?? '?'}`,
            source: 'provider',
          },
        },
        line,
      ),
    ];
  }
  return [createProviderOtherEvent(`system.${subtype ?? 'unknown'}`, line)];
}

/** Translates one block of an `assistant` message. */
function parseAssistantBlock(
  block: JsonObject,
  parentToolCallId: string | null,
): ParsedProviderEvent['event'] | undefined {
  const blockType = readString(block, 'type');
  if (blockType === CONTENT_BLOCK_TYPES.TEXT) {
    const text = readString(block, 'text') ?? '';
    return text === ''
      ? undefined
      : { type: 'assistant.text', payload: { text: limitText(text), parentToolCallId } };
  }
  if (blockType === CONTENT_BLOCK_TYPES.THINKING) {
    // Thinking text is often withheld (only a signature is sent); skip empty blocks.
    const text = readString(block, 'thinking') ?? '';
    return text === ''
      ? undefined
      : { type: 'assistant.thinking', payload: { text: limitText(text), parentToolCallId } };
  }
  if (blockType === CONTENT_BLOCK_TYPES.TOOL_USE) {
    return {
      type: 'tool.call',
      payload: {
        toolCallId: readString(block, 'id') ?? '',
        toolName: readString(block, 'name') ?? 'unknown',
        input: block.input ?? null,
        parentToolCallId,
      },
    };
  }
  return undefined;
}

function readMessageContent(line: JsonObject): JsonObject[] {
  const message = readObject(line, 'message');
  return message === undefined ? [] : readArray(message, 'content').filter(isJsonObject);
}

function parseAssistantLine(line: JsonObject): ParsedProviderEvent[] {
  const parentToolCallId = readString(line, 'parent_tool_use_id');
  const events = readMessageContent(line)
    .map((block) => parseAssistantBlock(block, parentToolCallId))
    .filter((event) => event !== undefined);
  return events.length === 0
    ? [createProviderOtherEvent('assistant.empty', line)]
    : attachRawPayloadToFirst(events, line);
}

/** Flattens a tool result's content, which is a string or a list of text blocks. */
function readToolResultText(block: JsonObject): string {
  const content = block.content;
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter(isJsonObject)
    .map((part) => readString(part, 'text') ?? `[${readString(part, 'type') ?? 'content'}]`)
    .join('\n');
}

function parseUserLine(line: JsonObject): ParsedProviderEvent[] {
  const events: ParsedProviderEvent['event'][] = readMessageContent(line)
    .filter((block) => readString(block, 'type') === CONTENT_BLOCK_TYPES.TOOL_RESULT)
    .map((block) => ({
      type: 'tool.result',
      payload: {
        toolCallId: readString(block, 'tool_use_id') ?? '',
        isError: block.is_error === true,
        ...limitToolOutput(readToolResultText(block)),
        exitCode: null,
      },
    }));
  return events.length === 0
    ? [createProviderOtherEvent('user', line)]
    : attachRawPayloadToFirst(events, line);
}

function parseRateLimitLine(line: JsonObject): ParsedProviderEvent[] {
  const info = readObject(line, 'rate_limit_info') ?? {};
  const limitType = readString(info, 'rateLimitType');
  const windows = readObject(info, 'unifiedWindows');
  const currentWindow =
    windows !== undefined && limitType !== null ? readObject(windows, limitType) : undefined;
  return [
    withRawPayload(
      {
        type: 'rate_limit',
        payload: {
          status: readString(info, 'status') ?? 'unknown',
          limitType,
          utilization:
            currentWindow === undefined ? null : readNumber(currentWindow, 'utilization'),
          resetsAt: toIsoFromEpochSeconds(readNumber(info, 'resetsAt')),
        },
      },
      line,
    ),
  ];
}

/**
 * Converts the reported dollar cost to micro-USD.
 *
 * @param costUsd - `total_cost_usd`, or null when missing.
 * @returns Integer micro-USD, or null.
 */
function toMicroUsd(costUsd: number | null): number | null {
  return costUsd === null || costUsd < 0 ? null : Math.round(costUsd * MICRO_USD_PER_USD);
}

function parseResultLine(line: JsonObject): ParsedProviderEvent[] {
  const usage = readObject(line, 'usage') ?? {};
  const costMicroUsd = toMicroUsd(readNumber(line, 'total_cost_usd'));
  const isError = line.is_error === true || readString(line, 'subtype') !== SUCCESS_RESULT_SUBTYPE;
  const errorSummary = readStringArray(line, 'errors').join('\n');
  const summary = readString(line, 'result') ?? (errorSummary === '' ? null : errorSummary);
  return attachRawPayloadToFirst(
    [
      {
        type: 'usage',
        payload: {
          inputTokens: readCount(usage, 'input_tokens'),
          outputTokens: readCount(usage, 'output_tokens'),
          cacheReadTokens: readCount(usage, 'cache_read_input_tokens'),
          cacheWriteTokens: readCount(usage, 'cache_creation_input_tokens'),
          costMicroUsd,
          costSource: costMicroUsd === null ? null : 'provider_reported',
        },
      },
      {
        type: 'run.result',
        payload: {
          isError,
          summary: summary === null ? null : limitText(summary),
          durationMs: readNumber(line, 'duration_ms'),
          turnCount: readNumber(line, 'num_turns'),
        },
      },
    ],
    line,
  );
}

/**
 * Translates one stream-json line into normalized events.
 *
 * @param line - A line of Claude Code's stdout.
 * @returns The events it produces.
 */
export function parseClaudeStreamLine(line: string): ParsedProviderEvent[] {
  const parsedLine = parseJsonObjectLine(line);
  if (parsedLine === undefined) {
    return [createUnparseableLineEvent(line)];
  }
  switch (readString(parsedLine, 'type')) {
    case CLAUDE_EVENT_TYPES.SYSTEM:
      return parseSystemLine(parsedLine);
    case CLAUDE_EVENT_TYPES.ASSISTANT:
      return parseAssistantLine(parsedLine);
    case CLAUDE_EVENT_TYPES.USER:
      return parseUserLine(parsedLine);
    case CLAUDE_EVENT_TYPES.RATE_LIMIT:
      return parseRateLimitLine(parsedLine);
    case CLAUDE_EVENT_TYPES.RESULT:
      return parseResultLine(parsedLine);
    default:
      return [createProviderOtherEvent(readString(parsedLine, 'type') ?? 'unknown', parsedLine)];
  }
}

/** Claude Code's lines are self-contained, so its parser keeps no state. */
function createClaudeOutputParser(): AgentOutputParser {
  return {
    parseStdoutLine: parseClaudeStreamLine,
    finish: () => [],
  };
}

/** The Claude Code adapter. */
export const claudeCodeAdapter: AgentAdapter = {
  providerSlug: 'claude_code',
  apiKeyEnvironmentVariable: 'ANTHROPIC_API_KEY',
  skillsDirectory: CLAUDE_SKILLS_DIRECTORY,
  buildInvocation({ model, apiKey }) {
    return {
      // `--model=<value>` keeps the value attached to its flag, so a model
      // name can never be read as a separate option.
      command: model === null ? CLAUDE_BASE_COMMAND : [...CLAUDE_BASE_COMMAND, `--model=${model}`],
      environment: {},
      secretEnvironment: { ANTHROPIC_API_KEY: apiKey },
    };
  },
  createOutputParser: createClaudeOutputParser,
};
