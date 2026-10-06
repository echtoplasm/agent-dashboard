/**
 * Lists agents and lets operators create new ones.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useNavigate } from 'react-router';
import { createAgent, listAgents } from '../../api/endpoints.js';
import { useCurrentUser } from '../../auth/AuthContext.js';
import { canManageRegistry } from '../../auth/permissions.js';
import { ResourceView } from '../../components/ResourceView.js';
import { ArchivedPill } from '../../components/StatusPill.js';
import { useApiResource, useAsyncAction } from '../../hooks/useApiResource.js';
import { findNameById, useRegistryLookups } from '../../hooks/useRegistryLookups.js';
import { formatMicroUsd } from '../../lib/money.js';
import { AgentForm } from './AgentForm.js';

/**
 * Renders the agents page.
 *
 * @returns The page.
 */
export function AgentsPage(): ReactElement {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const [isShowingArchived, setIsShowingArchived] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const agents = useApiResource(
    () => listAgents(isShowingArchived),
    `agents:${String(isShowingArchived)}`,
  );
  const lookups = useRegistryLookups();
  const createAction = useAsyncAction();

  return (
    <>
      <div className="page-header">
        <h1>Agents</h1>
        <div className="form-actions">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={isShowingArchived}
              onChange={(event) => {
                setIsShowingArchived(event.target.checked);
              }}
            />
            Show archived
          </label>
          {canManageRegistry(currentUser) && !isCreating && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setIsCreating(true);
              }}
            >
              New agent
            </button>
          )}
        </div>
      </div>

      {isCreating && (
        <section className="panel">
          <h2>New agent</h2>
          <ResourceView resource={lookups}>
            {({ providers, sandboxProfiles }) => (
              <AgentForm
                providers={providers}
                sandboxProfiles={sandboxProfiles}
                submitLabel="Create agent"
                isSubmitting={createAction.isRunning}
                submitError={createAction.error}
                onSubmit={(values) => {
                  void createAction.run(async () => {
                    const createdAgent = await createAgent(values);
                    await navigate(`/agents/${createdAgent.id}`);
                  });
                }}
                onCancel={() => {
                  setIsCreating(false);
                  createAction.clearError();
                }}
              />
            )}
          </ResourceView>
        </section>
      )}

      <section className="panel table-wrapper">
        <ResourceView resource={agents}>
          {(agentList) =>
            agentList.length === 0 ? (
              <p className="muted">No agents yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Provider</th>
                    <th>Sandbox profile</th>
                    <th>Budget per run</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {agentList.map((agent) => (
                    <tr key={agent.id}>
                      <td>
                        <Link to={`/agents/${agent.id}`}>{agent.name}</Link>
                        {agent.description !== '' && (
                          <div className="muted">{agent.description}</div>
                        )}
                      </td>
                      <td>
                        {findNameById(
                          lookups.data?.providers ?? [],
                          agent.providerId,
                          (provider) => provider.displayName,
                        )}
                      </td>
                      <td>
                        {findNameById(
                          lookups.data?.sandboxProfiles ?? [],
                          agent.sandboxProfileId,
                          (profile) => profile.name,
                        )}
                      </td>
                      <td>{formatMicroUsd(agent.maxCostPerRunMicroUsd)}</td>
                      <td>
                        <ArchivedPill archivedAt={agent.archivedAt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </ResourceView>
      </section>
    </>
  );
}
