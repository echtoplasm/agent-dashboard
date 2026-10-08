/**
 * Every run, newest first, filterable by agent and status and loaded a page
 * at a time.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { RUN_STATUSES } from '@agent-dashboard/shared';
import type { RunStatus, RunSummary } from '@agent-dashboard/shared';
import { listAgents, listRuns } from '../../api/endpoints.js';
import type { RunListFilters } from '../../api/endpoints.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import { FormField } from '../../components/FormField.js';
import { useApiResource, useAsyncAction } from '../../hooks/useApiResource.js';
import { getRunStatusLabel } from '../../lib/run-formatting.js';
import { RunsTable } from './RunsTable.js';

/**
 * Renders the runs page.
 *
 * @returns The page.
 */
export function RunsPage(): ReactElement {
  const [agentId, setAgentId] = useState('');
  const [status, setStatus] = useState<RunStatus | ''>('');
  const filters: RunListFilters = {
    ...(agentId === '' ? {} : { agentId }),
    ...(status === '' ? {} : { status }),
  };
  const filterKey = `runs:${agentId}:${status}`;
  const firstPage = useApiResource(() => listRuns(filters), filterKey);
  const agents = useApiResource(() => listAgents(true), 'agents:all');
  const [olderRuns, setOlderRuns] = useState<{
    key: string;
    runs: RunSummary[];
    cursor: string | null;
  }>();
  const loadMoreAction = useAsyncAction();

  const olderPage = olderRuns?.key === filterKey ? olderRuns : undefined;
  const runs = [...(firstPage.data?.items ?? []), ...(olderPage?.runs ?? [])];
  const nextCursor = olderPage === undefined ? firstPage.data?.nextCursor : olderPage.cursor;

  function loadOlderRuns(cursor: string): void {
    void loadMoreAction.run(async () => {
      const page = await listRuns({ ...filters, before: cursor });
      setOlderRuns({
        key: filterKey,
        runs: [...(olderPage?.runs ?? []), ...page.items],
        cursor: page.nextCursor,
      });
    });
  }

  return (
    <>
      <div className="page-header">
        <h1>Runs</h1>
        <button type="button" className="button button--quiet" onClick={firstPage.reload}>
          Refresh
        </button>
      </div>
      <div className="form-row">
        <FormField label="Agent">
          <select
            value={agentId}
            onChange={(changeEvent) => {
              setAgentId(changeEvent.target.value);
            }}
          >
            <option value="">All agents</option>
            {agents.data?.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Status">
          <select
            value={status}
            onChange={(changeEvent) => {
              setStatus(changeEvent.target.value as RunStatus | '');
            }}
          >
            <option value="">Any status</option>
            {RUN_STATUSES.map((runStatus) => (
              <option key={runStatus} value={runStatus}>
                {getRunStatusLabel(runStatus)}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <ErrorBanner error={firstPage.error ?? loadMoreAction.error} />
      <section className="panel">
        {firstPage.data === undefined ? (
          <p className="page-status">Loading…</p>
        ) : (
          <RunsTable runs={runs} isShowingAgent />
        )}
      </section>
      {nextCursor !== null && nextCursor !== undefined && (
        <button
          type="button"
          className="button button--quiet"
          disabled={loadMoreAction.isRunning}
          onClick={() => {
            loadOlderRuns(nextCursor);
          }}
        >
          Load older runs
        </button>
      )}
    </>
  );
}
