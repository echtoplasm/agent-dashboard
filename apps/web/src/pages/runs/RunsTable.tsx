/**
 * A table of runs, shared by the runs page and the agent page.
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router';
import type { RunSummary } from '@agent-dashboard/shared';
import { RunStatusPill } from '../../components/RunStatusPill.js';
import { describeRunDuration, formatRunCost, formatTokenCount } from '../../lib/run-formatting.js';

/**
 * Renders runs, newest first.
 *
 * @param props.runs - The runs to show.
 * @param props.isShowingAgent - Whether to include the agent column.
 * @returns The table, or a note when there are no runs.
 */
export function RunsTable({
  runs,
  isShowingAgent,
}: {
  runs: RunSummary[];
  isShowingAgent: boolean;
}): ReactElement {
  if (runs.length === 0) {
    return <p className="muted">No runs yet.</p>;
  }
  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Launched</th>
            {isShowingAgent && <th>Agent</th>}
            <th>Status</th>
            <th>Duration</th>
            <th>Tokens (in / out)</th>
            <th>Cost</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                <Link to={`/runs/${run.id}`}>{new Date(run.queuedAt).toLocaleString()}</Link>
              </td>
              {isShowingAgent && (
                <td>
                  <Link to={`/agents/${run.agentId}`}>{run.agentName}</Link>
                </td>
              )}
              <td>
                <RunStatusPill status={run.status} />
              </td>
              <td>{describeRunDuration(run)}</td>
              <td>
                {formatTokenCount(run.inputTokens)} / {formatTokenCount(run.outputTokens)}
              </td>
              <td>{formatRunCost(run)}</td>
              <td>{run.triggeredByUsername ?? <span className="muted">system</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
