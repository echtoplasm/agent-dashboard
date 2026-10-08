/**
 * Tests for the Codex adapter, replaying output recorded from codex-cli
 * 0.160.1.
 */
import { describe, expect, it } from 'vitest';
import { replayFixture, toEventData } from './adapter-test-helpers.js';
import { codexAdapter } from './codex.adapter.js';

describe('codexAdapter.buildInvocation', () => {
  it('reads the prompt from stdin and passes the key as a secret', () => {
    const invocation = codexAdapter.buildInvocation({ model: 'gpt-5.5-codex', apiKey: 'sk-test' });

    expect(invocation.command.slice(0, 3)).toEqual(['codex', 'exec', '--json']);
    expect(invocation.command.slice(-2)).toEqual(['--model=gpt-5.5-codex', '-']);
    expect(invocation.secretEnvironment).toEqual({ CODEX_API_KEY: 'sk-test' });
  });
});

describe('Codex output parsing', () => {
  it('translates a successful run and builds the final result', () => {
    const events = toEventData(
      replayFixture(codexAdapter.createOutputParser(), 'codex-success.jsonl'),
    );

    expect(events.map((event) => event.type)).toEqual([
      'session.started',
      'provider.other',
      'assistant.text',
      'tool.call',
      'tool.result',
      'tool.call',
      'tool.result',
      'assistant.text',
      'usage',
      'run.result',
    ]);
    expect(events[3]).toMatchObject({
      payload: {
        toolCallId: 'item_1',
        toolName: 'shell',
        input: { command: '/usr/bin/bash -lc ls' },
      },
    });
    expect(events[4]).toMatchObject({
      payload: { toolCallId: 'item_1', isError: false, exitCode: 0 },
    });
    expect(events[8]).toEqual({
      type: 'usage',
      payload: {
        inputTokens: 41_417 - 37_120,
        outputTokens: 108,
        cacheReadTokens: 37_120,
        cacheWriteTokens: 0,
        costMicroUsd: null,
        costSource: null,
      },
    });
    expect(events[9]).toEqual({
      type: 'run.result',
      payload: { isError: false, summary: 'done', durationMs: null, turnCount: 1 },
    });
  });

  it('marks a failed turn as a fatal error and the run as failed', () => {
    const events = toEventData(
      replayFixture(codexAdapter.createOutputParser(), 'codex-auth-failure.jsonl'),
    );
    const fatalErrors = events.filter((event) => event.type === 'error' && event.payload.isFatal);

    expect(fatalErrors).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: 'run.result',
      payload: { isError: true, turnCount: 0 },
    });
    expect(JSON.stringify(events.at(-1))).toContain('401 Unauthorized');
  });

  it('emits a tool call for a file change that arrives only as completed', () => {
    const parser = codexAdapter.createOutputParser();
    const line = JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'item_5',
        type: 'file_change',
        changes: [{ path: 'a.txt', kind: 'add' }],
        status: 'completed',
      },
    });

    expect(toEventData(parser.parseStdoutLine(line)).map((event) => event.type)).toEqual([
      'tool.call',
      'tool.result',
    ]);
  });

  it('flags a command with a non-zero exit code as an error', () => {
    const parser = codexAdapter.createOutputParser();
    const line = JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'item_2',
        type: 'command_execution',
        command: 'false',
        aggregated_output: '',
        exit_code: 1,
        status: 'failed',
      },
    });

    expect(toEventData(parser.parseStdoutLine(line))[1]).toMatchObject({
      type: 'tool.result',
      payload: { isError: true, exitCode: 1 },
    });
  });

  it('fails a run that exits without completing a turn', () => {
    const parser = codexAdapter.createOutputParser();

    expect(toEventData(parser.finish())).toEqual([
      {
        type: 'run.result',
        payload: { isError: true, summary: null, durationMs: null, turnCount: 0 },
      },
    ]);
  });
});
