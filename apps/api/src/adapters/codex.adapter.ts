/**
 * Adapter for the OpenAI Codex CLI, run as `codex exec --json`.
 *
 * Verified against codex-cli 0.160.1 in the sandbox image:
 *
 * - `--json` prints one JSON object per line: `thread.started`,
 *   `turn.started`, `item.started` / `item.updated` / `item.completed` for
 *   each message, command or file change, then `turn.completed` with token
 *   usage, or `turn.failed`. Transient problems arrive as `error` lines.
 * - There is no final result line, so the parser builds one when the CLI
 *   exits.
 * - Usage reports tokens only. `input_tokens` includes cached tokens, which
 *   are split out here so they can be priced separately.
 * - It authenticates with `CODEX_API_KEY` and keeps state in `CODEX_HOME`,
 *   which the sandbox points at its private HOME. `--ignore-user-config`
 *   and `--ignore-rules` keep any config there from being loaded.
 * - Codex's own sandbox needs kernel features Docker doesn't allow, so it is
 *   turned off and the container is the boundary instead (D-024).
 * - Skills are discovered from `$CODEX_HOME/skills/<name>/SKILL.md`.
 * - Logs go to stderr, which the run manager records as notices.
 */
import type { AgentAdapter, AgentOutputParser, ParsedProviderEvent } from './agent-adapter.js';
import {
  createProviderOtherEvent,
  createUnparseableLineEvent,
  limitText,
  limitToolOutput,
  parseJsonObjectLine,
  readArray,
  readCount,
  readNumber,
  readObject,
  readString,
} from './adapter-helpers.js';
import type { JsonObject } from './adapter-helpers.js';

/** Where Codex looks for skills inside the sandbox image. */
const CODEX_SKILLS_DIRECTORY = '/home/agent/.codex/skills';

const CODEX_BASE_COMMAND = [
  'codex',
  'exec',
  '--json',
  '--skip-git-repo-check',
  '--ephemeral',
  '--ignore-user-config',
  '--ignore-rules',
  '--dangerously-bypass-approvals-and-sandbox',
];

/** `-` tells `codex exec` to read the prompt from stdin. */
const READ_PROMPT_FROM_STDIN = '-';

const CODEX_EVENT_TYPES = {
  THREAD_STARTED: 'thread.started',
  TURN_COMPLETED: 'turn.completed',
  TURN_FAILED: 'turn.failed',
  ITEM_STARTED: 'item.started',
  ITEM_COMPLETED: 'item.completed',
  ERROR: 'error',
} as const;

const CODEX_ITEM_TYPES = {
  AGENT_MESSAGE: 'agent_message',
  REASONING: 'reasoning',
  COMMAND_EXECUTION: 'command_execution',
  FILE_CHANGE: 'file_change',
  MCP_TOOL_CALL: 'mcp_tool_call',
  WEB_SEARCH: 'web_search',
  ERROR: 'error',
} as const;

const FAILED_ITEM_STATUS = 'failed';

/** How a tool-like item is shown as a normalized tool call. */
interface ToolItemDescription {
  toolName: string;
  input: unknown;
}

/**
 * Describes items that behave like tool calls, or returns undefined for
 * items that don't (messages, reasoning, todo lists).
 */
function describeToolItem(item: JsonObject): ToolItemDescription | undefined {
  switch (readString(item, 'type')) {
    case CODEX_ITEM_TYPES.COMMAND_EXECUTION:
      return { toolName: 'shell', input: { command: readString(item, 'command') } };
    case CODEX_ITEM_TYPES.FILE_CHANGE:
      return { toolName: 'apply_patch', input: { changes: readArray(item, 'changes') } };
    case CODEX_ITEM_TYPES.MCP_TOOL_CALL:
      return {
        toolName: `mcp:${readString(item, 'server') ?? '?'}/${readString(item, 'tool') ?? '?'}`,
        input: item.arguments ?? null,
      };
    case CODEX_ITEM_TYPES.WEB_SEARCH:
      return { toolName: 'web_search', input: { query: readString(item, 'query') } };
    default:
      return undefined;
  }
}

/** Builds the text shown as a finished tool item's output. */
function readToolItemOutput(item: JsonObject): string {
  switch (readString(item, 'type')) {
    case CODEX_ITEM_TYPES.COMMAND_EXECUTION:
      return readString(item, 'aggregated_output') ?? '';
    case CODEX_ITEM_TYPES.FILE_CHANGE:
      return readArray(item, 'changes')
        .map((change) => JSON.stringify(change))
        .join('\n');
    case CODEX_ITEM_TYPES.MCP_TOOL_CALL: {
      const error = readObject(item, 'error');
      return error === undefined
        ? JSON.stringify(item.result ?? null)
        : (readString(error, 'message') ?? 'MCP tool call failed');
    }
    default:
      return '';
  }
}

function isToolItemFailed(item: JsonObject): boolean {
  const exitCode = readNumber(item, 'exit_code');
  return (
    readString(item, 'status') === FAILED_ITEM_STATUS ||
    (exitCode !== null && exitCode !== 0) ||
    readObject(item, 'error') !== undefined
  );
}

/** What the Codex parser remembers between lines. */
interface CodexParserState {
  /** Tool items whose `item.started` was already turned into a tool call. */
  startedToolItemIds: Set<string>;
  lastAgentMessage: string | null;
  lastErrorMessage: string | null;
  completedTurnCount: number;
  hasFatalError: boolean;
}

function createToolCallEvent(
  itemId: string,
  description: ToolItemDescription,
): ParsedProviderEvent['event'] {
  return {
    type: 'tool.call',
    payload: { toolCallId: itemId, ...description, parentToolCallId: null },
  };
}

function parseItemStarted(line: JsonObject, state: CodexParserState): ParsedProviderEvent[] {
  const item = readObject(line, 'item') ?? {};
  const itemId = readString(item, 'id') ?? '';
  const toolDescription = describeToolItem(item);
  if (toolDescription === undefined) {
    return [
      createProviderOtherEvent(`item.started.${readString(item, 'type') ?? 'unknown'}`, line),
    ];
  }
  state.startedToolItemIds.add(itemId);
  return [
    { event: createToolCallEvent(itemId, toolDescription), rawPayload: line, occurredAt: null },
  ];
}

function parseCompletedToolItem(
  line: JsonObject,
  item: JsonObject,
  toolDescription: ToolItemDescription,
  state: CodexParserState,
): ParsedProviderEvent[] {
  const itemId = readString(item, 'id') ?? '';
  const events: ParsedProviderEvent['event'][] = [];
  // Some items (file changes) arrive only as completed, with no start.
  if (!state.startedToolItemIds.has(itemId)) {
    events.push(createToolCallEvent(itemId, toolDescription));
  }
  state.startedToolItemIds.delete(itemId);
  events.push({
    type: 'tool.result',
    payload: {
      toolCallId: itemId,
      isError: isToolItemFailed(item),
      ...limitToolOutput(readToolItemOutput(item)),
      exitCode: readNumber(item, 'exit_code'),
    },
  });
  return events.map((event, index) => ({
    event,
    rawPayload: index === events.length - 1 ? line : null,
    occurredAt: null,
  }));
}

function parseItemCompleted(line: JsonObject, state: CodexParserState): ParsedProviderEvent[] {
  const item = readObject(line, 'item') ?? {};
  const itemType = readString(item, 'type');
  const text = readString(item, 'text') ?? '';
  if (itemType === CODEX_ITEM_TYPES.AGENT_MESSAGE) {
    state.lastAgentMessage = text;
    return [
      {
        event: {
          type: 'assistant.text',
          payload: { text: limitText(text), parentToolCallId: null },
        },
        rawPayload: line,
        occurredAt: null,
      },
    ];
  }
  if (itemType === CODEX_ITEM_TYPES.REASONING && text !== '') {
    return [
      {
        event: {
          type: 'assistant.thinking',
          payload: { text: limitText(text), parentToolCallId: null },
        },
        rawPayload: line,
        occurredAt: null,
      },
    ];
  }
  if (itemType === CODEX_ITEM_TYPES.ERROR) {
    const message = readString(item, 'message') ?? 'Unknown error';
    state.lastErrorMessage = message;
    return [
      {
        event: { type: 'error', payload: { message: limitText(message), isFatal: false } },
        rawPayload: line,
        occurredAt: null,
      },
    ];
  }
  const toolDescription = describeToolItem(item);
  return toolDescription === undefined
    ? [createProviderOtherEvent(`item.completed.${itemType ?? 'unknown'}`, line)]
    : parseCompletedToolItem(line, item, toolDescription, state);
}

function parseTurnCompleted(line: JsonObject, state: CodexParserState): ParsedProviderEvent[] {
  state.completedTurnCount += 1;
  const usage = readObject(line, 'usage') ?? {};
  const cacheReadTokens = readCount(usage, 'cached_input_tokens');
  return [
    {
      event: {
        type: 'usage',
        payload: {
          inputTokens: Math.max(0, readCount(usage, 'input_tokens') - cacheReadTokens),
          outputTokens: readCount(usage, 'output_tokens'),
          cacheReadTokens,
          cacheWriteTokens: readCount(usage, 'cache_write_input_tokens'),
          costMicroUsd: null,
          costSource: null,
        },
      },
      rawPayload: line,
      occurredAt: null,
    },
  ];
}

function createErrorEvent(
  line: JsonObject,
  message: string,
  isFatal: boolean,
  state: CodexParserState,
): ParsedProviderEvent[] {
  state.lastErrorMessage = message;
  state.hasFatalError ||= isFatal;
  return [
    {
      event: { type: 'error', payload: { message: limitText(message), isFatal } },
      rawPayload: line,
      occurredAt: null,
    },
  ];
}

/**
 * Translates one `codex exec --json` line, updating the parser state.
 *
 * @param line - A line of Codex's stdout.
 * @param state - State shared across the run's lines.
 * @returns The events it produces.
 */
function parseCodexLine(line: string, state: CodexParserState): ParsedProviderEvent[] {
  const parsedLine = parseJsonObjectLine(line);
  if (parsedLine === undefined) {
    return [createUnparseableLineEvent(line)];
  }
  const eventType = readString(parsedLine, 'type') ?? 'unknown';
  switch (eventType) {
    case CODEX_EVENT_TYPES.THREAD_STARTED:
      return [
        {
          event: {
            type: 'session.started',
            payload: {
              providerSessionId: readString(parsedLine, 'thread_id'),
              model: null,
              tools: [],
              skills: [],
            },
          },
          rawPayload: parsedLine,
          occurredAt: null,
        },
      ];
    case CODEX_EVENT_TYPES.ITEM_STARTED:
      return parseItemStarted(parsedLine, state);
    case CODEX_EVENT_TYPES.ITEM_COMPLETED:
      return parseItemCompleted(parsedLine, state);
    case CODEX_EVENT_TYPES.TURN_COMPLETED:
      return parseTurnCompleted(parsedLine, state);
    case CODEX_EVENT_TYPES.TURN_FAILED: {
      const error = readObject(parsedLine, 'error') ?? {};
      return createErrorEvent(
        parsedLine,
        readString(error, 'message') ?? 'Turn failed',
        true,
        state,
      );
    }
    case CODEX_EVENT_TYPES.ERROR:
      return createErrorEvent(
        parsedLine,
        readString(parsedLine, 'message') ?? 'Unknown error',
        false,
        state,
      );
    default:
      return [createProviderOtherEvent(eventType, parsedLine)];
  }
}

/**
 * Builds the final result Codex doesn't send itself.
 *
 * The run counts as an error if any turn failed or no turn completed.
 */
function buildCodexResult(state: CodexParserState): ParsedProviderEvent {
  const isError = state.hasFatalError || state.completedTurnCount === 0;
  const summary = isError
    ? (state.lastErrorMessage ?? state.lastAgentMessage)
    : (state.lastAgentMessage ?? state.lastErrorMessage);
  return {
    event: {
      type: 'run.result',
      payload: {
        isError,
        summary: summary === null ? null : limitText(summary),
        durationMs: null,
        turnCount: state.completedTurnCount,
      },
    },
    rawPayload: null,
    occurredAt: null,
  };
}

function createCodexOutputParser(): AgentOutputParser {
  const state: CodexParserState = {
    startedToolItemIds: new Set(),
    lastAgentMessage: null,
    lastErrorMessage: null,
    completedTurnCount: 0,
    hasFatalError: false,
  };
  return {
    parseStdoutLine: (line) => parseCodexLine(line, state),
    finish: () => [buildCodexResult(state)],
  };
}

/** The Codex adapter. */
export const codexAdapter: AgentAdapter = {
  providerSlug: 'codex',
  apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
  skillsDirectory: CODEX_SKILLS_DIRECTORY,
  buildInvocation({ model, apiKey }) {
    // `--model=<value>` keeps the value attached to its flag, so a model
    // name can never be read as a separate option.
    const modelArguments = model === null ? [] : [`--model=${model}`];
    return {
      command: [...CODEX_BASE_COMMAND, ...modelArguments, READ_PROMPT_FROM_STDIN],
      environment: {},
      secretEnvironment: { CODEX_API_KEY: apiKey },
    };
  },
  createOutputParser: createCodexOutputParser,
};
