/**
 * Data access for `sandbox_profiles`.
 *
 * The permission list columns are `jsonb` arrays. `pg` would send a plain
 * JavaScript array as a Postgres array literal, so arrays are JSON-encoded
 * before writing.
 */
import type { SandboxProfile } from '@agent-dashboard/shared';
import type { DatabaseExecutor } from '../../db/database-executor.js';
import { isUniqueViolation, toIsoString, toNullableIsoString } from '../../db/row-mapping.js';
import { ConflictError } from '../../errors/app-errors.js';
import type { SandboxProfileFields } from './sandbox-profiles.types.js';

interface SandboxProfileRow {
  id: string;
  name: string;
  description: string;
  container_image: string;
  cpu_limit_millicores: number;
  memory_limit_mb: number;
  max_run_duration_seconds: number;
  is_network_allowed: boolean;
  allowed_network_hosts: string[];
  writable_paths: string[];
  allowed_commands: string[];
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapSandboxProfileRow(row: SandboxProfileRow): SandboxProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    containerImage: row.container_image,
    cpuLimitMillicores: row.cpu_limit_millicores,
    memoryLimitMb: row.memory_limit_mb,
    maxRunDurationSeconds: row.max_run_duration_seconds,
    isNetworkAllowed: row.is_network_allowed,
    allowedNetworkHosts: row.allowed_network_hosts,
    writablePaths: row.writable_paths,
    allowedCommands: row.allowed_commands,
    archivedAt: toNullableIsoString(row.archived_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapSandboxProfileFields(fields: SandboxProfileFields): Record<string, unknown> {
  return {
    name: fields.name,
    description: fields.description,
    container_image: fields.containerImage,
    cpu_limit_millicores: fields.cpuLimitMillicores,
    memory_limit_mb: fields.memoryLimitMb,
    max_run_duration_seconds: fields.maxRunDurationSeconds,
    is_network_allowed: fields.isNetworkAllowed,
    allowed_network_hosts: JSON.stringify(fields.allowedNetworkHosts),
    writable_paths: JSON.stringify(fields.writablePaths),
    allowed_commands: JSON.stringify(fields.allowedCommands),
  };
}

const DUPLICATE_NAME_MESSAGE = 'An active sandbox profile with that name already exists';

/** Data access for sandbox profiles. */
export interface SandboxProfilesRepository {
  listSandboxProfiles(options: { isIncludingArchived: boolean }): Promise<SandboxProfile[]>;
  findSandboxProfileById(profileId: string): Promise<SandboxProfile | undefined>;
  /** @throws {ConflictError} If an active profile already has the name. */
  insertSandboxProfile(fields: SandboxProfileFields): Promise<SandboxProfile>;
  /** Replaces every editable field. @throws {ConflictError} On a duplicate name. */
  updateSandboxProfile(
    profileId: string,
    fields: SandboxProfileFields,
  ): Promise<SandboxProfile | undefined>;
  archiveSandboxProfile(profileId: string): Promise<SandboxProfile | undefined>;
  /** Counts non-archived agents that use the profile. */
  countActiveAgentsUsingProfile(profileId: string): Promise<number>;
}

/**
 * Creates the sandbox profiles repository.
 *
 * @param database - A Knex client or transaction.
 * @returns The repository.
 */
export function createSandboxProfilesRepository(
  database: DatabaseExecutor,
): SandboxProfilesRepository {
  async function writeProfile(
    write: () => Promise<SandboxProfileRow[]>,
  ): Promise<SandboxProfile | undefined> {
    try {
      const [row] = await write();
      return row === undefined ? undefined : mapSandboxProfileRow(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(DUPLICATE_NAME_MESSAGE);
      }
      throw error;
    }
  }

  return {
    async listSandboxProfiles({ isIncludingArchived }) {
      const query = database<SandboxProfileRow>('sandbox_profiles').orderBy('name');
      if (!isIncludingArchived) {
        query.whereNull('archived_at');
      }
      return (await query).map(mapSandboxProfileRow);
    },

    async findSandboxProfileById(profileId) {
      const row = await database<SandboxProfileRow>('sandbox_profiles')
        .where({ id: profileId })
        .first();
      return row === undefined ? undefined : mapSandboxProfileRow(row);
    },

    async insertSandboxProfile(fields) {
      const insertedProfile = await writeProfile(() =>
        database<SandboxProfileRow>('sandbox_profiles')
          .insert(mapSandboxProfileFields(fields))
          .returning('*'),
      );
      if (insertedProfile === undefined) {
        throw new Error('Inserting a sandbox profile returned no row');
      }
      return insertedProfile;
    },

    async updateSandboxProfile(profileId, fields) {
      return writeProfile(() =>
        database<SandboxProfileRow>('sandbox_profiles')
          .where({ id: profileId })
          .update(mapSandboxProfileFields(fields))
          .returning('*'),
      );
    },

    async archiveSandboxProfile(profileId) {
      return writeProfile(() =>
        database<SandboxProfileRow>('sandbox_profiles')
          .where({ id: profileId })
          .update({ archived_at: database.fn.now() })
          .returning('*'),
      );
    },

    async countActiveAgentsUsingProfile(profileId) {
      const [result] = await database('agents')
        .where({ sandbox_profile_id: profileId })
        .whereNull('archived_at')
        .count<{ count: number }[]>({ count: '*' });
      return result?.count ?? 0;
    },
  };
}
