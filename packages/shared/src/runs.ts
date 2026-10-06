/**
 * Agent run lifecycle values.
 */
import { z } from 'zod';

/**
 * Every state an agent run can be in, in lifecycle order.
 *
 * `queued` → `starting` → `running` → one of the terminal states.
 */
export const RUN_STATUSES = [
  'queued',
  'starting',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
] as const;

/** Validates a run status. */
export const RunStatusSchema = z.enum(RUN_STATUSES);

/** The lifecycle state of an agent run. */
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** Statuses after which a run will never change again. */
export const TERMINAL_RUN_STATUSES = [
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
] as const satisfies readonly RunStatus[];

/**
 * Reports whether a run has finished and can no longer change state.
 *
 * @param runStatus - The run's current status.
 * @returns `true` for succeeded, failed, cancelled and timed-out runs.
 */
export function isTerminalRunStatus(runStatus: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(runStatus);
}
