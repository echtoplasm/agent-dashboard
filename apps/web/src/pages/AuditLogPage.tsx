/**
 * The audit log, newest first, loaded a page at a time.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { AuditEntry } from '@agent-dashboard/shared';
import { listAuditLog } from '../api/endpoints.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { useAsyncAction } from '../hooks/useApiResource.js';
import { useApiResource } from '../hooks/useApiResource.js';

function describeTarget(entry: AuditEntry): string {
  if (entry.targetType === null) {
    return '—';
  }
  return `${entry.targetType} ${entry.targetId ?? ''}`.trim();
}

/**
 * Renders the audit log page.
 *
 * @returns The page.
 */
export function AuditLogPage(): ReactElement {
  const firstPage = useApiResource(() => listAuditLog(), 'audit-log');
  const [olderEntries, setOlderEntries] = useState<AuditEntry[]>([]);
  const [olderCursor, setOlderCursor] = useState<number | null | undefined>(undefined);
  const loadMoreAction = useAsyncAction();

  const entries = [...(firstPage.data?.items ?? []), ...olderEntries];
  const nextCursor = olderCursor === undefined ? firstPage.data?.nextCursor : olderCursor;

  function loadOlderEntries(cursor: number): void {
    void loadMoreAction.run(async () => {
      const page = await listAuditLog(cursor);
      setOlderEntries((current) => [...current, ...page.items]);
      setOlderCursor(page.nextCursor);
    });
  }

  return (
    <>
      <h1>Audit log</h1>
      <ErrorBanner error={firstPage.error ?? loadMoreAction.error} />
      <section className="panel table-wrapper">
        {firstPage.isLoading && entries.length === 0 ? (
          <p className="page-status">Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Target</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.createdAt).toLocaleString()}</td>
                  <td>
                    {entry.actorUsername ?? <span className="muted">system</span>}
                    {entry.ipAddress !== null && <div className="muted">{entry.ipAddress}</div>}
                  </td>
                  <td>
                    <code>{entry.action}</code>
                  </td>
                  <td>{describeTarget(entry)}</td>
                  <td>
                    {Object.keys(entry.metadata).length > 0 && (
                      <code>{JSON.stringify(entry.metadata)}</code>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {nextCursor !== null && nextCursor !== undefined && (
        <button
          type="button"
          className="button button--quiet"
          disabled={loadMoreAction.isRunning}
          onClick={() => {
            loadOlderEntries(nextCursor);
          }}
        >
          Load older entries
        </button>
      )}
    </>
  );
}
