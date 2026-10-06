/**
 * Tests for run status helpers.
 */
import { describe, expect, it } from 'vitest';
import { isTerminalRunStatus } from './runs.js';

describe('isTerminalRunStatus', () => {
  it.each(['succeeded', 'failed', 'cancelled', 'timed_out'] as const)(
    'treats %s as terminal',
    (runStatus) => {
      expect(isTerminalRunStatus(runStatus)).toBe(true);
    },
  );

  it.each(['queued', 'starting', 'running'] as const)('treats %s as in progress', (runStatus) => {
    expect(isTerminalRunStatus(runStatus)).toBe(false);
  });
});
