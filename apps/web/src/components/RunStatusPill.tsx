/**
 * A run's status as a coloured pill.
 */
import type { ReactElement } from 'react';
import type { RunStatus } from '@agent-dashboard/shared';
import { getRunStatusLabel, getRunStatusTone } from '../lib/run-formatting.js';
import { StatusPill } from './StatusPill.js';

/**
 * Renders a run status pill.
 *
 * @param props.status - The run's status.
 * @returns The pill.
 */
export function RunStatusPill({ status }: { status: RunStatus }): ReactElement {
  return <StatusPill label={getRunStatusLabel(status)} tone={getRunStatusTone(status)} />;
}
