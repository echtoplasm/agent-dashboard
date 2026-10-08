/**
 * Tests for the normalized run event schemas.
 */
import { describe, expect, it } from 'vitest';
import { RunEventDataSchema, RunEventSchema, truncateText } from './run-events.js';

describe('RunEventDataSchema', () => {
  it('accepts a tool call with any input shape', () => {
    const event = {
      type: 'tool.call',
      payload: {
        toolCallId: 'item_1',
        toolName: 'shell',
        input: { command: 'ls' },
        parentToolCallId: null,
      },
    };
    expect(RunEventDataSchema.parse(event)).toEqual(event);
  });

  it('rejects a payload that does not match its type', () => {
    const result = RunEventDataSchema.safeParse({
      type: 'usage',
      payload: { text: 'not usage' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown event types', () => {
    expect(RunEventDataSchema.safeParse({ type: 'made.up', payload: {} }).success).toBe(false);
  });
});

describe('RunEventSchema', () => {
  it('combines storage fields with the event data', () => {
    const storedEvent = {
      runId: '01a11c8e-f46f-76e2-bfd7-a18c9506df99',
      sequenceNumber: 3,
      occurredAt: null,
      receivedAt: '2026-10-08T17:00:00.000Z',
      type: 'assistant.text',
      payload: { text: 'done', parentToolCallId: null },
    };
    expect(RunEventSchema.parse(storedEvent)).toEqual(storedEvent);
  });
});

describe('truncateText', () => {
  it('leaves short text alone', () => {
    expect(truncateText('abc', 5)).toEqual({ text: 'abc', isTruncated: false });
  });

  it('cuts long text and says so', () => {
    expect(truncateText('abcdef', 4)).toEqual({ text: 'abcd', isTruncated: true });
  });
});
