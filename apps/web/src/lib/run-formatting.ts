/**
 * Display formatting for runs: status tones, durations, token counts and cost.
 */
import type { RunStatus, RunSummary } from '@agent-dashboard/shared';
import type { PillTone } from '../components/StatusPill.js';
import { formatMicroUsd } from './money.js';

const RUN_STATUS_TONES: Record<RunStatus, PillTone> = {
  queued: 'neutral',
  starting: 'warn',
  running: 'warn',
  succeeded: 'good',
  failed: 'bad',
  cancelled: 'neutral',
  timed_out: 'bad',
};

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Queued',
  starting: 'Starting',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  timed_out: 'Timed out',
};

const MILLISECONDS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/**
 * Returns the pill tone for a run status.
 *
 * @param status - The run's status.
 * @returns Good for success, bad for failures, warn while active.
 */
export function getRunStatusTone(status: RunStatus): PillTone {
  return RUN_STATUS_TONES[status];
}

/**
 * Returns a readable label for a run status.
 *
 * @param status - The run's status.
 * @returns e.g. `Timed out`.
 */
export function getRunStatusLabel(status: RunStatus): string {
  return RUN_STATUS_LABELS[status];
}

/**
 * Formats a duration in milliseconds.
 *
 * @param durationMs - Elapsed milliseconds.
 * @returns e.g. `850ms`, `42s`, `3m 05s` or `1h 02m`.
 */
export function formatDuration(durationMs: number): string {
  if (durationMs < MILLISECONDS_PER_SECOND) {
    return `${Math.max(0, Math.round(durationMs))}ms`;
  }
  const totalSeconds = Math.floor(durationMs / MILLISECONDS_PER_SECOND);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  if (totalMinutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

/**
 * Describes how long a run took, or has been running so far.
 *
 * @param run - The run.
 * @param now - The current time, for active runs.
 * @returns A duration, or `—` if it never started.
 */
export function describeRunDuration(
  run: Pick<RunSummary, 'startedAt' | 'endedAt'>,
  now: Date = new Date(),
): string {
  if (run.startedAt === null) {
    return '—';
  }
  const endTime = run.endedAt === null ? now.getTime() : new Date(run.endedAt).getTime();
  return formatDuration(endTime - new Date(run.startedAt).getTime());
}

/**
 * Formats a token count with thousands separators.
 *
 * @param tokens - A count, or null when not reported.
 * @returns e.g. `41,417`, or `—`.
 */
export function formatTokenCount(tokens: number | null): string {
  return tokens === null ? '—' : tokens.toLocaleString('en-US');
}

/**
 * Formats a run's cost, saying when it is an estimate.
 *
 * @param run - The run's cost fields.
 * @returns e.g. `$0.0125`, `~$0.011091 (estimated)`, or `—` when unknown.
 */
export function formatRunCost(run: Pick<RunSummary, 'costMicroUsd' | 'costSource'>): string {
  if (run.costMicroUsd === null) {
    return '—';
  }
  const amount = formatMicroUsd(run.costMicroUsd);
  return run.costSource === 'estimated' ? `~${amount} (estimated)` : amount;
}
