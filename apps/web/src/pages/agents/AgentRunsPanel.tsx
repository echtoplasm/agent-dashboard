/**
 * The runs side of an agent: a form to launch a run, usage totals, and the
 * most recent runs.
 */
import { useState } from 'react';
import type { ReactElement, SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { MAX_RUN_PROMPT_LENGTH } from '@agent-dashboard/shared';
import type { Agent } from '@agent-dashboard/shared';
import { getAgentUsage, launchRun, listRuns } from '../../api/endpoints.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import { FormField } from '../../components/FormField.js';
import { ResourceView } from '../../components/ResourceView.js';
import { useApiResource, useAsyncAction } from '../../hooks/useApiResource.js';
import { formatMicroUsd } from '../../lib/money.js';
import { formatTokenCount } from '../../lib/run-formatting.js';
import { RunsTable } from '../runs/RunsTable.js';

const RECENT_RUN_COUNT = 5;

/**
 * Renders the launch form, usage totals and recent runs for an agent.
 *
 * @param props.agent - The agent.
 * @param props.canLaunch - Whether the signed-in user may launch runs of it.
 * @returns The panels.
 */
export function AgentRunsPanel({
  agent,
  canLaunch,
}: {
  agent: Agent;
  canLaunch: boolean;
}): ReactElement {
  return (
    <>
      {canLaunch && <LaunchRunForm agent={agent} />}
      <AgentUsagePanel agentId={agent.id} />
      <RecentRunsPanel agentId={agent.id} />
    </>
  );
}

function LaunchRunForm({ agent }: { agent: Agent }): ReactElement {
  const [prompt, setPrompt] = useState('');
  const launchAction = useAsyncAction();
  const navigate = useNavigate();

  function handleSubmit(submitEvent: SyntheticEvent): void {
    submitEvent.preventDefault();
    void launchAction.run(async () => {
      const run = await launchRun({ agentId: agent.id, prompt });
      await navigate(`/runs/${run.id}`);
    });
  }

  return (
    <section className="panel">
      <h2>Launch a run</h2>
      <form className="form" onSubmit={handleSubmit}>
        <FormField
          label="Prompt"
          hint="The agent runs in a fresh, empty workspace with only its assigned skills."
        >
          <textarea
            rows={5}
            value={prompt}
            maxLength={MAX_RUN_PROMPT_LENGTH}
            required
            onChange={(changeEvent) => {
              setPrompt(changeEvent.target.value);
            }}
          />
        </FormField>
        <ErrorBanner error={launchAction.error} />
        <div className="form-actions">
          <button
            type="submit"
            className="button"
            disabled={launchAction.isRunning || prompt.trim() === ''}
          >
            {launchAction.isRunning ? 'Launching…' : 'Launch run'}
          </button>
        </div>
      </form>
    </section>
  );
}

function AgentUsagePanel({ agentId }: { agentId: string }): ReactElement {
  const usage = useApiResource(() => getAgentUsage(agentId), `usage:${agentId}`);
  return (
    <section className="panel">
      <h2>Usage</h2>
      <ResourceView resource={usage}>
        {(loadedUsage) => (
          <dl className="details">
            <dt>Runs</dt>
            <dd>
              {loadedUsage.runCount}
              {loadedUsage.activeRunCount > 0 && ` (${loadedUsage.activeRunCount} active)`}
            </dd>
            <dt>Tokens</dt>
            <dd>
              {formatTokenCount(loadedUsage.inputTokens)} in ·{' '}
              {formatTokenCount(loadedUsage.outputTokens)} out ·{' '}
              {formatTokenCount(loadedUsage.cacheReadTokens)} cache read
            </dd>
            <dt>Cost, all time</dt>
            <dd>{formatMicroUsd(loadedUsage.costMicroUsd)}</dd>
            <dt>Cost, this month</dt>
            <dd>{formatMicroUsd(loadedUsage.monthToDateCostMicroUsd)}</dd>
            {loadedUsage.unpricedRunCount > 0 && (
              <>
                <dt>Unpriced runs</dt>
                <dd>
                  {loadedUsage.unpricedRunCount} run(s) have no cost because their model has no
                  price. <Link to="/model-prices">Set model prices</Link>
                </dd>
              </>
            )}
          </dl>
        )}
      </ResourceView>
    </section>
  );
}

function RecentRunsPanel({ agentId }: { agentId: string }): ReactElement {
  const runs = useApiResource(
    () => listRuns({ agentId, limit: RECENT_RUN_COUNT }),
    `recent-runs:${agentId}`,
  );
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Recent runs</h2>
        <Link to="/runs">All runs</Link>
      </div>
      <ResourceView resource={runs}>
        {(page) => <RunsTable runs={page.items} isShowingAgent={false} />}
      </ResourceView>
    </section>
  );
}
