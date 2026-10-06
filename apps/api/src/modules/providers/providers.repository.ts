/**
 * Data access for `agent_providers`.
 */
import type { Provider, ProviderSlug } from '@agent-dashboard/shared';
import type { DatabaseExecutor } from '../../db/database-executor.js';
import { toIsoString } from '../../db/row-mapping.js';

interface ProviderRow {
  id: string;
  slug: ProviderSlug;
  display_name: string;
  cli_command: string;
  default_args: string[];
  skills_directory: string | null;
  is_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapProviderRow(row: ProviderRow): Provider {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    cliCommand: row.cli_command,
    defaultArgs: row.default_args,
    skillsDirectory: row.skills_directory,
    isEnabled: row.is_enabled,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

/** Data access for providers. */
export interface ProvidersRepository {
  listProviders(): Promise<Provider[]>;
  findProviderById(providerId: string): Promise<Provider | undefined>;
  /** Returns the providers with the given ids that exist. */
  findProvidersByIds(providerIds: readonly string[]): Promise<Provider[]>;
  setProviderEnabled(providerId: string, isEnabled: boolean): Promise<Provider | undefined>;
}

/**
 * Creates the providers repository.
 *
 * @param database - A Knex client or transaction.
 * @returns The repository.
 */
export function createProvidersRepository(database: DatabaseExecutor): ProvidersRepository {
  return {
    async listProviders() {
      const rows = await database<ProviderRow>('agent_providers').orderBy('display_name');
      return rows.map(mapProviderRow);
    },

    async findProviderById(providerId) {
      const row = await database<ProviderRow>('agent_providers').where({ id: providerId }).first();
      return row === undefined ? undefined : mapProviderRow(row);
    },

    async findProvidersByIds(providerIds) {
      const rows = await database<ProviderRow>('agent_providers').whereIn('id', providerIds);
      return rows.map(mapProviderRow);
    },

    async setProviderEnabled(providerId, isEnabled) {
      const [row] = await database<ProviderRow>('agent_providers')
        .where({ id: providerId })
        .update({ is_enabled: isEnabled })
        .returning('*');
      return row === undefined ? undefined : mapProviderRow(row);
    },
  };
}
