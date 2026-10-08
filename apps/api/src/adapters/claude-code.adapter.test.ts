/**
 * Tests for the Claude Code adapter, replaying output recorded from Claude
 * Code 2.1.291.
 */
import { describe, expect, it } from 'vitest';
import { replayFixture, toEventData } from './adapter-test-helpers.js';
import { claudeCodeAdapter, parseClaudeStreamLine } from './claude-code.adapter.js';

describe('claudeCodeAdapter.buildInvocation', () => {
  it('runs headless stream-json with the key passed as a secret', () => {
    const invocation = claudeCodeAdapter.buildInvocation({ model: null, apiKey: 'sk-ant-test' });

    expect(invocation.command).toEqual([
      'claude',
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--permission-mode',
      'bypassPermissions',
    ]);
    expect(invocation.secretEnvironment).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(invocation.command.join(' ')).not.toContain('sk-ant-test');
  });

  it('attaches the model to its flag so it cannot be read as another option', () => {
    const invocation = claudeCodeAdapter.buildInvocation({ model: 'claude-opus-5-5', apiKey: 'k' });

    expect(invocation.command.at(-1)).toBe('--model=claude-opus-5-5');
  });
});

describe('Claude Code output parsing', () => {
  it('translates a successful run with tool calls', () => {
    const events = toEventData(
      replayFixture(claudeCodeAdapter.createOutputParser(), 'claude-code-success.jsonl'),
    );
    const eventTypes = events.map((event) => event.type);

    expect(eventTypes).toEqual([
      'session.started',
      'provider.other',
      'tool.call',
      'tool.result',
      'tool.call',
      'tool.result',
      'rate_limit',
      'provider.other',
      'assistant.text',
      'usage',
      'run.result',
    ]);
    expect(events[0]).toMatchObject({
      payload: { model: 'claude-haiku-4-5-20251001', skills: ['greeter'] },
    });
    expect(events[2]).toMatchObject({
      payload: { toolName: 'Bash', input: { command: 'ls' } },
    });
    expect(events[3]).toMatchObject({ payload: { isError: false, exitCode: null } });
    expect(events[9]).toEqual({
      type: 'usage',
      payload: {
        inputTokens: 18,
        outputTokens: 290,
        cacheReadTokens: 32_637,
        cacheWriteTokens: 9_247,
        costMicroUsd: 23_226,
        costSource: 'provider_reported',
      },
    });
    expect(events[10]).toEqual({
      type: 'run.result',
      payload: { isError: false, summary: 'Done', durationMs: 4_257, turnCount: 3 },
    });
  });

  it('marks a run that failed to authenticate as an error', () => {
    const events = toEventData(
      replayFixture(claudeCodeAdapter.createOutputParser(), 'claude-code-auth-failure.jsonl'),
    );

    expect(events.at(-1)).toMatchObject({
      type: 'run.result',
      payload: {
        isError: true,
        summary: 'Failed to authenticate. API Error: 401 API key is invalid.',
      },
    });
  });

  it('keeps the raw JSON on the first event of each line only', () => {
    const parsedEvents = replayFixture(
      claudeCodeAdapter.createOutputParser(),
      'claude-code-success.jsonl',
    );
    const [usageEvent, resultEvent] = parsedEvents.slice(-2);

    expect(usageEvent?.rawPayload).toMatchObject({ type: 'result' });
    expect(resultEvent?.rawPayload).toBeNull();
  });

  it('turns a non-JSON line into a notice instead of dropping it', () => {
    expect(toEventData(parseClaudeStreamLine('Error: something broke'))).toEqual([
      { type: 'notice', payload: { message: 'Error: something broke', source: 'provider' } },
    ]);
  });

  it('flattens tool results given as a list of text blocks', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            is_error: true,
            content: [{ type: 'text', text: 'first' }, { type: 'image' }],
          },
        ],
      },
    });

    expect(toEventData(parseClaudeStreamLine(line))).toEqual([
      {
        type: 'tool.result',
        payload: {
          toolCallId: 'toolu_1',
          isError: true,
          output: 'first\n[image]',
          isOutputTruncated: false,
          exitCode: null,
        },
      },
    ]);
  });

  it('treats a non-success result subtype as an error even without is_error', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'error_max_turns',
      errors: ['Reached maximum number of turns'],
      usage: {},
    });

    expect(toEventData(parseClaudeStreamLine(line))[1]).toMatchObject({
      payload: { isError: true, summary: 'Reached maximum number of turns' },
    });
  });

  it('reports retries as notices', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'api_retry',
      attempt: 2,
      max_retries: 10,
      error: 'overloaded',
    });

    expect(toEventData(parseClaudeStreamLine(line))).toEqual([
      {
        type: 'notice',
        payload: { message: 'API request failed (overloaded); retry 2 of 10', source: 'provider' },
      },
    ]);
  });
});
