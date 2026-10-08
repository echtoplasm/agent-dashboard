/**
 * Tests for building the run log.
 */
import type { RunEvent, RunEventData } from '@agent-dashboard/shared';
import { describe, expect, it } from 'vitest';
import { buildRunLogItems, summarizeToolInput } from './run-log-items.js';

const RUN_ID = '01a11c8e-f46f-76e2-bfd7-a18c9506df99';

function storeEvents(eventData: RunEventData[]): RunEvent[] {
  return eventData.map((data, sequenceNumber) => ({
    ...data,
    runId: RUN_ID,
    sequenceNumber,
    occurredAt: null,
    receivedAt: '2026-10-08T10:00:00.000Z',
  }));
}

describe('buildRunLogItems', () => {
  it('pairs tool calls with their results', () => {
    const items = buildRunLogItems(
      storeEvents([
        {
          type: 'tool.call',
          payload: {
            toolCallId: 't1',
            toolName: 'Bash',
            input: { command: 'ls' },
            parentToolCallId: null,
          },
        },
        { type: 'assistant.text', payload: { text: 'checking', parentToolCallId: null } },
        {
          type: 'tool.result',
          payload: {
            toolCallId: 't1',
            isError: false,
            output: 'a.txt',
            isOutputTruncated: false,
            exitCode: 0,
          },
        },
      ]),
      { isShowingProviderEvents: false },
    );

    expect(items.map((item) => item.kind)).toEqual(['tool', 'event']);
    expect(items[0]).toMatchObject({ kind: 'tool', result: { output: 'a.txt' } });
  });

  it('groups consecutive stderr lines', () => {
    const items = buildRunLogItems(
      storeEvents([
        { type: 'notice', payload: { message: 'one', source: 'stderr' } },
        { type: 'notice', payload: { message: 'two', source: 'stderr' } },
        { type: 'notice', payload: { message: 'retrying', source: 'provider' } },
        { type: 'notice', payload: { message: 'three', source: 'stderr' } },
      ]),
      { isShowingProviderEvents: false },
    );

    expect(items).toEqual([
      { kind: 'stderr', key: '0', lines: ['one', 'two'] },
      expect.objectContaining({ kind: 'event' }),
      { kind: 'stderr', key: '3', lines: ['three'] },
    ]);
  });

  it('hides untranslated provider events unless asked', () => {
    const events = storeEvents([
      { type: 'provider.other', payload: { providerEventType: 'turn.started' } },
    ]);

    expect(buildRunLogItems(events, { isShowingProviderEvents: false })).toEqual([]);
    expect(buildRunLogItems(events, { isShowingProviderEvents: true })).toHaveLength(1);
  });
});

describe('summarizeToolInput', () => {
  it('prefers the command or path', () => {
    expect(summarizeToolInput({ command: 'npm test', description: 'x' })).toBe('npm test');
    expect(summarizeToolInput({ file_path: '/workspace/a.ts', content: 'x' })).toBe(
      '/workspace/a.ts',
    );
  });

  it('falls back to truncated JSON', () => {
    expect(summarizeToolInput({ changes: ['x'.repeat(200)] })).toMatch(/^\{"changes":\["x+…$/);
  });
});
