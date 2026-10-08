/**
 * Tests for deciding a run's final status.
 */
import { describe, expect, it } from 'vitest';
import { decideRunCompletion } from './run-completion.js';
import type { RunOutcome } from './run-completion.js';

function buildOutcome(overrides: Partial<RunOutcome> = {}): RunOutcome {
  return {
    stopReason: null,
    exitCode: 0,
    runResult: { isError: false, summary: 'done', durationMs: 10, turnCount: 1 },
    lastFatalErrorMessage: null,
    stderrTail: [],
    maxRunDurationSeconds: 600,
    ...overrides,
  };
}

describe('decideRunCompletion', () => {
  it('succeeds on exit 0 with a non-error result', () => {
    expect(decideRunCompletion(buildOutcome())).toEqual({
      status: 'succeeded',
      exitCode: 0,
      errorMessage: null,
    });
  });

  it('fails with the provider summary when the result is an error', () => {
    const outcome = buildOutcome({
      exitCode: 1,
      runResult: { isError: true, summary: 'API key is invalid', durationMs: null, turnCount: 0 },
    });

    expect(decideRunCompletion(outcome)).toEqual({
      status: 'failed',
      exitCode: 1,
      errorMessage: 'API key is invalid',
    });
  });

  it('fails when the CLI exits 0 without reporting a result', () => {
    expect(decideRunCompletion(buildOutcome({ runResult: null })).errorMessage).toBe(
      'The agent exited without reporting a result',
    );
  });

  it('uses the last fatal error when there is no result summary', () => {
    const outcome = buildOutcome({
      exitCode: 1,
      runResult: null,
      lastFatalErrorMessage: 'turn failed',
    });

    expect(decideRunCompletion(outcome).errorMessage).toBe('turn failed');
  });

  it('explains sandbox start failures with the end of stderr', () => {
    const outcome = buildOutcome({
      exitCode: 125,
      runResult: null,
      stderrTail: ['docker: Error response from daemon: No such image: missing:latest'],
    });

    expect(decideRunCompletion(outcome).errorMessage).toBe(
      'The sandbox could not start the agent: docker: Error response from daemon: No such image: missing:latest',
    );
  });

  it.each([
    ['cancelled', 'cancelled'],
    ['timed_out', 'timed_out'],
    ['shutdown', 'failed'],
  ] as const)('reports a %s stop as %s whatever the exit code', (stopReason, status) => {
    expect(decideRunCompletion(buildOutcome({ stopReason, exitCode: 143 })).status).toBe(status);
  });

  it('names the duration limit when a run times out', () => {
    expect(decideRunCompletion(buildOutcome({ stopReason: 'timed_out' })).errorMessage).toBe(
      "Stopped after the sandbox profile's limit of 600 seconds",
    );
  });
});
