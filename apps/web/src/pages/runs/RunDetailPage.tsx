/**
 * One run: status, usage and cost, the prompt, the exact skill versions it
 * ran with, its live output, and the files it left in its workspace.
 *
 * The run's events arrive over SSE. When a status or usage event arrives,
 * the run itself is reloaded so the header and totals stay current.
 */
import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router';
import { isTerminalRunStatus } from '@agent-dashboard/shared';
import type { RunDetail } from '@agent-dashboard/shared';
import {
  buildWorkspaceFileUrl,
  cancelRun,
  getRun,
  listWorkspaceFiles,
} from '../../api/endpoints.js';
import { useCurrentUser } from '../../auth/AuthContext.js';
import { canManageRegistry } from '../../auth/permissions.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import { ResourceView } from '../../components/ResourceView.js';
import { RunStatusPill } from '../../components/RunStatusPill.js';
import { useApiResource, useAsyncAction } from '../../hooks/useApiResource.js';
import { useRunEventStream } from '../../hooks/useRunEventStream.js';
import { describeRunDuration, formatRunCost, formatTokenCount } from '../../lib/run-formatting.js';
import { RunEventLog } from './RunEventLog.js';

/** Event types after which the run row has changed and is worth reloading. */
const RUN_CHANGING_EVENT_TYPES = new Set(['run.status', 'usage', 'session.started']);

/**
 * Renders the run detail page for the `:runId` route parameter.
 *
 * @returns The page.
 */
export function RunDetailPage(): ReactElement {
  const { runId = '' } = useParams();
  const run = useApiResource(() => getRun(runId), `run:${runId}`);
  const stream = useRunEventStream(runId);
  const lastEvent = stream.events.at(-1);
  const { reload } = run;

  useEffect(() => {
    if (lastEvent !== undefined && RUN_CHANGING_EVENT_TYPES.has(lastEvent.type)) {
      reload();
    }
  }, [lastEvent, reload]);

  return (
    <ResourceView resource={run}>
      {(loadedRun) => (
        <>
          <RunHeader run={loadedRun} onChanged={reload} />
          {stream.isReconnecting && <p className="page-status">Connection lost; reconnecting…</p>}
          <RunSummaryPanel run={loadedRun} />
          <RunEventLog events={stream.events} />
          {isTerminalRunStatus(loadedRun.status) && <WorkspacePanel runId={loadedRun.id} />}
        </>
      )}
    </ResourceView>
  );
}

function RunHeader({ run, onChanged }: { run: RunDetail; onChanged: () => void }): ReactElement {
  const currentUser = useCurrentUser();
  const cancelAction = useAsyncAction();
  const isCancellable = canManageRegistry(currentUser) && !isTerminalRunStatus(run.status);
  return (
    <>
      <div className="page-header">
        <h1>
          Run of <Link to={`/agents/${run.agentId}`}>{run.agentName}</Link>{' '}
          <RunStatusPill status={run.status} />
        </h1>
        {isCancellable && (
          <button
            type="button"
            className="button button--danger"
            disabled={cancelAction.isRunning}
            onClick={() => {
              if (window.confirm('Cancel this run? The agent is stopped immediately.')) {
                void cancelAction.run(() => cancelRun(run.id)).then(onChanged);
              }
            }}
          >
            Cancel run
          </button>
        )}
      </div>
      <ErrorBanner error={cancelAction.error} />
    </>
  );
}

function RunSummaryPanel({ run }: { run: RunDetail }): ReactElement {
  return (
    <section className="panel">
      {run.errorMessage !== null && <p className="error-banner">{run.errorMessage}</p>}
      <dl className="details">
        <dt>Launched</dt>
        <dd>
          {new Date(run.queuedAt).toLocaleString()} by{' '}
          {run.triggeredByUsername ?? <span className="muted">system</span>}
        </dd>
        <dt>Duration</dt>
        <dd>{describeRunDuration(run)}</dd>
        <dt>Provider and model</dt>
        <dd>
          {run.providerSlug} · {run.model ?? 'provider default'}
        </dd>
        <dt>Tokens</dt>
        <dd>
          {formatTokenCount(run.inputTokens)} in · {formatTokenCount(run.outputTokens)} out ·{' '}
          {formatTokenCount(run.cacheReadTokens)} cache read ·{' '}
          {formatTokenCount(run.cacheWriteTokens)} cache write
        </dd>
        <dt>Cost</dt>
        <dd>{formatRunCost(run)}</dd>
        <dt>Skills</dt>
        <dd>
          {run.skillVersions.length === 0
            ? 'None'
            : run.skillVersions.map((skillVersion) => (
                <div key={skillVersion.skillVersionId}>
                  <Link
                    to={`/skills/${skillVersion.skillId}/versions/${skillVersion.skillVersionId}`}
                  >
                    {skillVersion.skillSlug}@{skillVersion.version}
                  </Link>{' '}
                  <code className="muted" title={skillVersion.contentHash}>
                    {skillVersion.contentHash.slice(0, 12)}
                  </code>
                </div>
              ))}
        </dd>
        <dt>Exit code</dt>
        <dd>{run.exitCode ?? '—'}</dd>
        <dt>Sandbox</dt>
        <dd>{run.sandboxId === null ? '—' : <code>{run.sandboxId}</code>}</dd>
      </dl>
      <h2>Prompt</h2>
      <pre className="run-prompt">{run.prompt}</pre>
    </section>
  );
}

function WorkspacePanel({ runId }: { runId: string }): ReactElement {
  const listing = useApiResource(() => listWorkspaceFiles(runId), `workspace:${runId}`);
  return (
    <section className="panel">
      <h2>Workspace files</h2>
      <ResourceView resource={listing}>
        {(loadedListing) =>
          loadedListing.items.length === 0 ? (
            <p className="muted">The run left no files.</p>
          ) : (
            <>
              <ul className="link-list">
                {loadedListing.items.map((file) => (
                  <li key={file.path}>
                    <a href={buildWorkspaceFileUrl(runId, file.path)} download>
                      {file.path}
                    </a>{' '}
                    <span className="muted">{file.sizeBytes.toLocaleString('en-US')} bytes</span>
                  </li>
                ))}
              </ul>
              {loadedListing.isTruncated && (
                <p className="muted">
                  Only the first {loadedListing.items.length} files are listed.
                </p>
              )}
            </>
          )
        }
      </ResourceView>
    </section>
  );
}
