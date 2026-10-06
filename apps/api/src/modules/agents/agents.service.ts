/**
 * Business rules for agents.
 *
 * - An agent can only be pointed at an enabled provider and an active
 *   sandbox profile. These are checked only when the field changes, so
 *   editing the description of an agent whose provider was later disabled
 *   still works.
 * - Archived agents are read-only.
 * - Changing the provider or sandbox profile must keep every assigned skill
 *   valid (see `loadout-rules.ts`).
 */
import type { Agent, CreateAgentRequest, UpdateAgentRequest } from '@agent-dashboard/shared';
import type { DataAccess, Repositories } from '../../db/data-access.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/app-errors.js';
import { applyChanges } from '../../utils/apply-changes.js';
import { assertLoadoutFits } from '../assignments/loadout-rules.js';
import type { AuditContext } from '../audit/audit.types.js';
import type { AgentFields } from './agents.types.js';

/** Agent operations. */
export interface AgentsService {
  listAgents(options: { isIncludingArchived: boolean }): Promise<Agent[]>;
  /** @throws {NotFoundError} */
  getAgent(agentId: string): Promise<Agent>;
  /** @throws {ValidationError | ConflictError} */
  createAgent(input: CreateAgentRequest, context: AuditContext): Promise<Agent>;
  /** @throws {NotFoundError | ValidationError | ConflictError} */
  updateAgent(agentId: string, changes: UpdateAgentRequest, context: AuditContext): Promise<Agent>;
  /** @throws {NotFoundError | ConflictError} If already archived. */
  archiveAgent(agentId: string, context: AuditContext): Promise<Agent>;
}

/**
 * Checks that a provider exists and is enabled.
 *
 * @throws {ValidationError} If no provider has the id.
 * @throws {ConflictError} If the provider is disabled.
 */
async function assertProviderUsable(repositories: Repositories, providerId: string): Promise<void> {
  const provider = await repositories.providers.findProviderById(providerId);
  if (provider === undefined) {
    throw new ValidationError([{ path: 'providerId', message: 'Unknown provider' }]);
  }
  if (!provider.isEnabled) {
    throw new ConflictError(`Provider "${provider.displayName}" is disabled`);
  }
}

/**
 * Checks that a sandbox profile exists and is not archived.
 *
 * @throws {ValidationError} If no profile has the id.
 * @throws {ConflictError} If the profile is archived.
 */
async function assertSandboxProfileUsable(
  repositories: Repositories,
  sandboxProfileId: string,
): Promise<void> {
  const profile = await repositories.sandboxProfiles.findSandboxProfileById(sandboxProfileId);
  if (profile === undefined) {
    throw new ValidationError([{ path: 'sandboxProfileId', message: 'Unknown sandbox profile' }]);
  }
  if (profile.archivedAt !== null) {
    throw new ConflictError(`Sandbox profile "${profile.name}" is archived`);
  }
}

/**
 * Loads an agent that may still be changed.
 *
 * @throws {NotFoundError} If it does not exist.
 * @throws {ConflictError} If it is archived.
 */
async function findEditableAgent(repositories: Repositories, agentId: string): Promise<Agent> {
  const agent = await repositories.agents.findAgentById(agentId);
  if (agent === undefined) {
    throw new NotFoundError('Agent not found');
  }
  if (agent.archivedAt !== null) {
    throw new ConflictError('Archived agents cannot be changed');
  }
  return agent;
}

/**
 * Re-checks an agent's assigned skills against a new provider or profile.
 *
 * @throws {ConflictError} If any assigned skill would no longer fit.
 */
async function assertLoadoutFitsNewSettings(
  repositories: Repositories,
  agentId: string,
  fields: AgentFields,
): Promise<void> {
  const profile = await repositories.sandboxProfiles.findSandboxProfileById(
    fields.sandboxProfileId,
  );
  if (profile === undefined) {
    throw new ValidationError([{ path: 'sandboxProfileId', message: 'Unknown sandbox profile' }]);
  }
  await assertLoadoutFits(
    repositories,
    { id: agentId, name: fields.name, providerId: fields.providerId },
    profile,
  );
}

function toAgentFields(agent: Agent): AgentFields {
  return {
    name: agent.name,
    description: agent.description,
    providerId: agent.providerId,
    sandboxProfileId: agent.sandboxProfileId,
    model: agent.model,
    maxCostPerRunMicroUsd: agent.maxCostPerRunMicroUsd,
    maxCostPerMonthMicroUsd: agent.maxCostPerMonthMicroUsd,
  };
}

/**
 * Creates the agents service.
 *
 * @param dataAccess - Repositories and the transaction runner.
 * @returns The service.
 */
export function createAgentsService(dataAccess: DataAccess): AgentsService {
  return {
    listAgents: (options) => dataAccess.repositories.agents.listAgents(options),

    async getAgent(agentId) {
      const agent = await dataAccess.repositories.agents.findAgentById(agentId);
      if (agent === undefined) {
        throw new NotFoundError('Agent not found');
      }
      return agent;
    },

    async createAgent(input, context) {
      return dataAccess.runInTransaction(async (repositories) => {
        await assertProviderUsable(repositories, input.providerId);
        await assertSandboxProfileUsable(repositories, input.sandboxProfileId);

        const createdAgent = await repositories.agents.insertAgent(input, context.actorUserId);
        await repositories.audit.insertAuditEntry(context, {
          action: 'agent.created',
          targetType: 'agent',
          targetId: createdAgent.id,
          metadata: { name: createdAgent.name },
        });
        return createdAgent;
      });
    },

    async updateAgent(agentId, changes, context) {
      return dataAccess.runInTransaction(async (repositories) => {
        const currentAgent = await findEditableAgent(repositories, agentId);
        const mergedFields = applyChanges(toAgentFields(currentAgent), changes);
        if (mergedFields.providerId !== currentAgent.providerId) {
          await assertProviderUsable(repositories, mergedFields.providerId);
        }
        if (mergedFields.sandboxProfileId !== currentAgent.sandboxProfileId) {
          await assertSandboxProfileUsable(repositories, mergedFields.sandboxProfileId);
        }
        const isProviderOrProfileChanged =
          mergedFields.providerId !== currentAgent.providerId ||
          mergedFields.sandboxProfileId !== currentAgent.sandboxProfileId;
        if (isProviderOrProfileChanged) {
          await assertLoadoutFitsNewSettings(repositories, agentId, mergedFields);
        }

        const updatedAgent = await repositories.agents.updateAgent(agentId, mergedFields);
        if (updatedAgent === undefined) {
          throw new NotFoundError('Agent not found');
        }
        await repositories.audit.insertAuditEntry(context, {
          action: 'agent.updated',
          targetType: 'agent',
          targetId: agentId,
          metadata: { changes },
        });
        return updatedAgent;
      });
    },

    async archiveAgent(agentId, context) {
      return dataAccess.runInTransaction(async (repositories) => {
        await findEditableAgent(repositories, agentId);
        const archivedAgent = await repositories.agents.archiveAgent(agentId);
        if (archivedAgent === undefined) {
          throw new NotFoundError('Agent not found');
        }
        await repositories.audit.insertAuditEntry(context, {
          action: 'agent.archived',
          targetType: 'agent',
          targetId: agentId,
          metadata: {},
        });
        return archivedAgent;
      });
    },
  };
}
