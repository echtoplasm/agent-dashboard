/**
 * Decides a run's final status and error message from how it ended.
 *
 * Kept free of I/O so every combination of exit code, provider verdict and
 * stop reason can be unit tested.
 */
import type { RunResultEventPayload } from '@agent-dashboard/shared';
import type { RunCompletion } from './runs.types.js';

/** Why the API stopped a run before it finished on its own. */
export type RunStopReason = 'cancelled' | 'timed_out' | 'shutdown';

/** Exit codes `docker run` uses for its own failures rather than the command's. */
const SANDBOX_FAILURE_EXIT_CODES = new Set([125, 126, 127]);

/** Everything known about how a run ended. */
export interface RunOutcome {
  stopReason: RunStopReason | null;
  exitCode: number | null;
  /** The provider's `run.result` event, if it sent one. */
  runResult: RunResultEventPayload | null;
  /** The last error the provider marked as fatal. */
  lastFatalErrorMessage: string | null;
  /** The last lines of stderr, for failures that happen before the CLI starts. */
  stderrTail: readonly string[];
  maxRunDurationSeconds: number;
}

function describeUnexpectedExit(outcome: RunOutcome): string {
  if (outcome.exitCode !== null && SANDBOX_FAILURE_EXIT_CODES.has(outcome.exitCode)) {
    const detail = outcome.stderrTail.join('\n').trim();
    return `The sandbox could not start the agent${detail === '' ? '' : `: ${detail}`}`;
  }
  if (outcome.exitCode === 0) {
    return 'The agent exited without reporting a result';
  }
  return outcome.exitCode === null
    ? 'The agent was killed by a signal'
    : `The agent exited with code ${outcome.exitCode}`;
}

function describeFailure(outcome: RunOutcome): string {
  if (outcome.runResult?.isError === true && outcome.runResult.summary !== null) {
    return outcome.runResult.summary;
  }
  return outcome.lastFatalErrorMessage ?? describeUnexpectedExit(outcome);
}

/**
 * Works out the final status of a run.
 *
 * A run succeeds only if the CLI exited with code 0 and reported a result
 * that isn't an error. A stop requested by the API always wins, because the
 * CLI's exit code after being stopped says nothing about the task.
 *
 * @param outcome - How the run ended.
 * @returns The status, exit code and error message to store.
 */
export function decideRunCompletion(outcome: RunOutcome): RunCompletion {
  const { exitCode } = outcome;
  switch (outcome.stopReason) {
    case 'cancelled':
      return { status: 'cancelled', exitCode, errorMessage: 'Cancelled by a user' };
    case 'timed_out':
      return {
        status: 'timed_out',
        exitCode,
        errorMessage: `Stopped after the sandbox profile's limit of ${outcome.maxRunDurationSeconds} seconds`,
      };
    case 'shutdown':
      return {
        status: 'failed',
        exitCode,
        errorMessage: 'The API shut down while the run was active',
      };
    case null:
      break;
  }
  const isSuccessful = exitCode === 0 && outcome.runResult !== null && !outcome.runResult.isError;
  return isSuccessful
    ? { status: 'succeeded', exitCode, errorMessage: null }
    : { status: 'failed', exitCode, errorMessage: describeFailure(outcome) };
}
