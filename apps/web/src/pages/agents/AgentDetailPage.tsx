/**
 * One agent: its settings, an edit form for operators, and its skill loadout.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { useParams } from 'react-router';
import type { Agent } from '@agent-dashboard/shared';
import { archiveAgent, getAgent, updateAgent } from '../../api/endpoints.js';
import { useCurrentUser } from '../../auth/AuthContext.js';
import { canManageRegistry } from '../../auth/permissions.js';
import { ErrorBanner } from '../../components/ErrorBanner.js';
import { ResourceView } from '../../components/ResourceView.js';
import { ArchivedPill } from '../../components/StatusPill.js';
import { useApiResource, useAsyncAction } from '../../hooks/useApiResource.js';
import { findNameById, useRegistryLookups } from '../../hooks/useRegistryLookups.js';
import type { RegistryLookups } from '../../hooks/useRegistryLookups.js';
import { formatMicroUsd } from '../../lib/money.js';
import { AgentForm } from './AgentForm.js';
import { AgentRunsPanel } from './AgentRunsPanel.js';
import { LoadoutPanel } from './LoadoutPanel.js';

/**
 * Renders the agent detail page for the `:agentId` route parameter.
 *
 * @returns The page.
 */
export function AgentDetailPage(): ReactElement {
  const { agentId = '' } = useParams();
  const agent = useApiResource(() => getAgent(agentId), `agent:${agentId}`);
  const lookups = useRegistryLookups();

  return (
    <ResourceView resource={agent}>
      {(loadedAgent) => (
        <ResourceView resource={lookups}>
          {(loadedLookups) => (
            <AgentDetails agent={loadedAgent} lookups={loadedLookups} onChanged={agent.reload} />
          )}
        </ResourceView>
      )}
    </ResourceView>
  );
}

function AgentDetails({
  agent,
  lookups,
  onChanged,
}: {
  agent: Agent;
  lookups: RegistryLookups;
  onChanged: () => void;
}): ReactElement {
  const currentUser = useCurrentUser();
  const [isEditing, setIsEditing] = useState(false);
  const updateAction = useAsyncAction();
  const archiveAction = useAsyncAction();
  const isEditable = canManageRegistry(currentUser) && agent.archivedAt === null;

  return (
    <>
      <div className="page-header">
        <h1>
          {agent.name} <ArchivedPill archivedAt={agent.archivedAt} />
        </h1>
        {isEditable && !isEditing && (
          <div className="form-actions">
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                setIsEditing(true);
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="button button--danger"
              disabled={archiveAction.isRunning}
              onClick={() => {
                if (window.confirm(`Archive ${agent.name}? It becomes read-only.`)) {
                  void archiveAction.run(() => archiveAgent(agent.id)).then(onChanged);
                }
              }}
            >
              Archive
            </button>
          </div>
        )}
      </div>
      <ErrorBanner error={archiveAction.error} />

      <section className="panel">
        {isEditing ? (
          <AgentForm
            initialAgent={agent}
            providers={lookups.providers}
            sandboxProfiles={lookups.sandboxProfiles}
            submitLabel="Save changes"
            isSubmitting={updateAction.isRunning}
            submitError={updateAction.error}
            onSubmit={(values) => {
              void updateAction
                .run(() => updateAgent(agent.id, values))
                .then((isSaved) => {
                  if (isSaved) {
                    setIsEditing(false);
                    onChanged();
                  }
                });
            }}
            onCancel={() => {
              setIsEditing(false);
              updateAction.clearError();
            }}
          />
        ) : (
          <dl className="details">
            <dt>Description</dt>
            <dd>{agent.description === '' ? '—' : agent.description}</dd>
            <dt>Provider</dt>
            <dd>
              {findNameById(
                lookups.providers,
                agent.providerId,
                (provider) => provider.displayName,
              )}
            </dd>
            <dt>Sandbox profile</dt>
            <dd>
              {findNameById(
                lookups.sandboxProfiles,
                agent.sandboxProfileId,
                (profile) => profile.name,
              )}
            </dd>
            <dt>Model</dt>
            <dd>{agent.model ?? 'Provider default'}</dd>
            <dt>Budget per run</dt>
            <dd>{formatMicroUsd(agent.maxCostPerRunMicroUsd)}</dd>
            <dt>Budget per month</dt>
            <dd>{formatMicroUsd(agent.maxCostPerMonthMicroUsd)}</dd>
          </dl>
        )}
      </section>

      <AgentRunsPanel agent={agent} canLaunch={isEditable} />
      <LoadoutPanel agent={agent} isEditable={isEditable} />
    </>
  );
}
