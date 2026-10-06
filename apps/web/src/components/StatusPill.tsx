/**
 * Small coloured label for a row's state.
 */
import type { ReactElement } from 'react';

/** Visual tones a pill can take. */
export type PillTone = 'good' | 'warn' | 'bad' | 'neutral';

/**
 * Renders a pill label.
 *
 * @param props.label - Text to show.
 * @param props.tone - Colour.
 * @returns The pill.
 */
export function StatusPill({ label, tone }: { label: string; tone: PillTone }): ReactElement {
  return <span className={`status-badge status-badge--${tone}`}>{label}</span>;
}

/**
 * Shows "Active" or "Archived" for archivable rows.
 *
 * @param props.archivedAt - The row's `archivedAt`.
 * @returns The pill.
 */
export function ArchivedPill({ archivedAt }: { archivedAt: string | null }): ReactElement {
  return archivedAt === null ? (
    <StatusPill label="Active" tone="good" />
  ) : (
    <StatusPill label="Archived" tone="neutral" />
  );
}
