/**
 * Data access for `agents`.
 */
import type { Agent } from '@agent-dashboard/shared';
import type { DatabaseExecutor } from '../../db/database-executor.js';
import { isUniqueViolation, toIsoString, toNullableIsoString } from '../../db/row-mapping.js';
import { ConflictError } from '../../errors/app-errors.js';
import type { AgentFields } from './agents.types.js';

interface AgentRow {
  id: string;
  name: string;
  description: string;
  provider_id: string;
  sandbox_profile_id: string;
  model: string | null;
  max_cost_per_run_micro_usd: number | null;
  max_cost_per_month_micro_usd: number | null;
  created_by: string | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapAgentRow(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    providerId: row.provider_id,
    sandboxProfileId: row.sandbox_profile_id,
    model: row.model,
    maxCostPerRunMicroUsd: row.max_cost_per_run_micro_usd,
    maxCostPerMonthMicroUsd: row.max_cost_per_month_micro_usd,
    createdBy: row.created_by,
    archivedAt: toNullableIsoString(row.archived_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapAgentFields(fields: AgentFields): Partial<AgentRow> {
  return {
    name: fields.name,
    description: fields.description,
    provider_id: fields.providerId,
    sandbox_profile_id: fields.sandboxProfileId,
    model: fields.model,
    max_cost_per_run_micro_usd: fields.maxCostPerRunMicroUsd,
    max_cost_per_month_micro_usd: fields.maxCostPerMonthMicroUsd,
  };
}

const DUPLICATE_NAME_MESSAGE = 'An active agent with that name already exists';

/** Data access for agents. */
export interface AgentsRepository {
  listAgents(options: { isIncludingArchived: boolean }): Promise<Agent[]>;
  findAgentById(agentId: string): Promise<Agent | undefined>;
  /** @throws {ConflictError} If an active agent already has the name. */
  insertAgent(fields: AgentFields, createdBy: string | null): Promise<Agent>;
  /** Replaces every editable field. @throws {ConflictError} On a duplicate name. */
  updateAgent(agentId: string, fields: AgentFields): Promise<Agent | undefined>;
  archiveAgent(agentId: string): Promise<Agent | undefined>;
  /** Non-archived agents that use the sandbox profile. */
  listActiveAgentsUsingProfile(sandboxProfileId: string): Promise<Agent[]>;
}

/**
 * Creates the agents repository.
 *
 * @param database - A Knex client or transaction.
 * @returns The repository.
 */
export function createAgentsRepository(database: DatabaseExecutor): AgentsRepository {
  async function writeAgent(write: () => Promise<AgentRow[]>): Promise<Agent | undefined> {
    try {
      const [row] = await write();
      return row === undefined ? undefined : mapAgentRow(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(DUPLICATE_NAME_MESSAGE);
      }
      throw error;
    }
  }

  return {
    async listAgents({ isIncludingArchived }) {
      const query = database<AgentRow>('agents').orderBy('name');
      if (!isIncludingArchived) {
        query.whereNull('archived_at');
      }
      return (await query).map(mapAgentRow);
    },

    async findAgentById(agentId) {
      const row = await database<AgentRow>('agents').where({ id: agentId }).first();
      return row === undefined ? undefined : mapAgentRow(row);
    },

    async insertAgent(fields, createdBy) {
      const insertedAgent = await writeAgent(() =>
        database<AgentRow>('agents')
          .insert({ ...mapAgentFields(fields), created_by: createdBy })
          .returning('*'),
      );
      if (insertedAgent === undefined) {
        throw new Error('Inserting an agent returned no row');
      }
      return insertedAgent;
    },

    async updateAgent(agentId, fields) {
      return writeAgent(() =>
        database<AgentRow>('agents')
          .where({ id: agentId })
          .update(mapAgentFields(fields))
          .returning('*'),
      );
    },

    async listActiveAgentsUsingProfile(sandboxProfileId) {
      const rows = await database<AgentRow>('agents')
        .where({ sandbox_profile_id: sandboxProfileId })
        .whereNull('archived_at');
      return rows.map(mapAgentRow);
    },

    async archiveAgent(agentId) {
      return writeAgent(() =>
        database<AgentRow>('agents')
          .where({ id: agentId })
          .update({ archived_at: database.fn.now() })
          .returning('*'),
      );
    },
  };
}
