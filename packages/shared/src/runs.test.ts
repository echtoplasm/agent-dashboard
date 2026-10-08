/**
 * Tests for run status helpers.
 */
import { describe, expect, it } from 'vitest';
import { LaunchRunRequestSchema, MAX_RUN_PROMPT_LENGTH, isTerminalRunStatus } from './runs.js';

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

describe('LaunchRunRequestSchema', () => {
  const agentId = '01a11c8e-f46f-76e2-bfd7-a18c9506df99';

  it('accepts a prompt and keeps its whitespace', () => {
    expect(LaunchRunRequestSchema.parse({ agentId, prompt: '  fix the tests\n' })).toEqual({
      agentId,
      prompt: '  fix the tests\n',
    });
  });

  it('rejects a blank prompt', () => {
    expect(LaunchRunRequestSchema.safeParse({ agentId, prompt: ' \n ' }).success).toBe(false);
  });

  it('rejects a prompt over the length limit', () => {
    const prompt = 'x'.repeat(MAX_RUN_PROMPT_LENGTH + 1);
    expect(LaunchRunRequestSchema.safeParse({ agentId, prompt }).success).toBe(false);
  });
});
