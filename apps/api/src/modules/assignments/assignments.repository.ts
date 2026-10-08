/**
 * Data access for `agent_skill_assignments`: which version of each skill an
 * agent has (its loadout).
 */
import type { AgentSkillAssignment } from '@agent-dashboard/shared';
import { SkillPermissionsManifestSchema } from '@agent-dashboard/shared';
import type { DatabaseExecutor } from '../../db/database-executor.js';
import { toIsoString } from '../../db/row-mapping.js';
import type { LaunchSkillVersion } from '../runs/runs.types.js';
import type { LoadoutEntry } from './assignments.types.js';

interface AssignmentRow {
  agent_id: string;
  skill_id: string;
  skill_slug: string;
  skill_name: string;
  skill_version_id: string;
  version: string;
  assigned_by: string | null;
  assigned_at: Date;
}

interface LoadoutEntryRow {
  skill_id: string;
  skill_name: string;
  version: string;
  supported_provider_ids: string[];
  permissions_manifest: unknown;
}

interface LaunchSkillVersionRow extends LoadoutEntryRow {
  skill_version_id: string;
  skill_slug: string;
  content_hash: string;
  storage_path: string;
}

function mapAssignmentRow(row: AssignmentRow): AgentSkillAssignment {
  return {
    agentId: row.agent_id,
    skillId: row.skill_id,
    skillSlug: row.skill_slug,
    skillName: row.skill_name,
    skillVersionId: row.skill_version_id,
    version: row.version,
    assignedBy: row.assigned_by,
    assignedAt: toIsoString(row.assigned_at),
  };
}

/** A new or replacement assignment. */
export interface AssignmentChange {
  agentId: string;
  skillId: string;
  skillVersionId: string;
  assignedBy: string | null;
}

/** Data access for assignments. */
export interface AssignmentsRepository {
  /** An agent's loadout, ordered by skill name. */
  listAssignmentsForAgent(agentId: string): Promise<AgentSkillAssignment[]>;
  findAssignment(agentId: string, skillId: string): Promise<AgentSkillAssignment | undefined>;
  /** Assigns a version, replacing any version of the same skill the agent had. */
  upsertAssignment(change: AssignmentChange): Promise<void>;
  /** @returns Whether an assignment was removed. */
  deleteAssignment(agentId: string, skillId: string): Promise<boolean>;
  /** Everything needed to re-check an agent's loadout against its provider and profile. */
  listLoadoutEntries(agentId: string): Promise<LoadoutEntry[]>;
  /** The loadout plus what launching needs: slugs, content hashes and storage paths. */
  listLaunchSkillVersions(agentId: string): Promise<LaunchSkillVersion[]>;
  /** Non-archived agents that have any version of the skill assigned. */
  listActiveAgentsAssignedSkill(
    skillId: string,
  ): Promise<{ agentId: string; agentName: string; providerId: string }[]>;
}

/**
 * Creates the assignments repository.
 *
 * @param database - A Knex client or transaction.
 * @returns The repository.
 */
export function createAssignmentsRepository(database: DatabaseExecutor): AssignmentsRepository {
  function selectAssignments() {
    return database('agent_skill_assignments')
      .join('skills', 'skills.id', 'agent_skill_assignments.skill_id')
      .join('skill_versions', 'skill_versions.id', 'agent_skill_assignments.skill_version_id')
      .select<AssignmentRow[]>(
        'agent_skill_assignments.agent_id',
        'agent_skill_assignments.skill_id',
        'skills.slug AS skill_slug',
        'skills.name AS skill_name',
        'agent_skill_assignments.skill_version_id',
        'skill_versions.version',
        'agent_skill_assignments.assigned_by',
        'agent_skill_assignments.assigned_at',
      )
      .orderBy('skills.name');
  }

  /** An agent's assigned versions with the columns every loadout check needs. */
  function selectLoadoutRows(agentId: string) {
    return database('agent_skill_assignments')
      .join('skills', 'skills.id', 'agent_skill_assignments.skill_id')
      .join('skill_versions', 'skill_versions.id', 'agent_skill_assignments.skill_version_id')
      .where('agent_skill_assignments.agent_id', agentId)
      .orderBy('skills.slug')
      .select(
        'skills.id AS skill_id',
        'skills.name AS skill_name',
        'skill_versions.version',
        'skill_versions.permissions_manifest',
        database.raw(
          `coalesce((SELECT array_agg(provider_id) FROM skill_supported_providers
             WHERE skill_id = skills.id), '{}') AS supported_provider_ids`,
        ),
      );
  }

  return {
    async listAssignmentsForAgent(agentId) {
      const rows = await selectAssignments().where('agent_skill_assignments.agent_id', agentId);
      return rows.map(mapAssignmentRow);
    },

    async findAssignment(agentId, skillId) {
      const [row] = await selectAssignments()
        .where('agent_skill_assignments.agent_id', agentId)
        .andWhere('agent_skill_assignments.skill_id', skillId);
      return row === undefined ? undefined : mapAssignmentRow(row);
    },

    async upsertAssignment(change) {
      await database('agent_skill_assignments')
        .insert({
          agent_id: change.agentId,
          skill_id: change.skillId,
          skill_version_id: change.skillVersionId,
          assigned_by: change.assignedBy,
        })
        .onConflict(['agent_id', 'skill_id'])
        .merge({
          skill_version_id: change.skillVersionId,
          assigned_by: change.assignedBy,
          assigned_at: database.fn.now(),
        });
    },

    async deleteAssignment(agentId, skillId) {
      const deletedCount = await database('agent_skill_assignments')
        .where({ agent_id: agentId, skill_id: skillId })
        .delete();
      return deletedCount > 0;
    },

    async listLaunchSkillVersions(agentId) {
      const rows = await selectLoadoutRows(agentId).select<LaunchSkillVersionRow[]>(
        'skill_versions.id AS skill_version_id',
        'skills.slug AS skill_slug',
        'skill_versions.content_hash',
        'skill_versions.storage_path',
      );
      return rows.map((row) => ({
        skillVersionId: row.skill_version_id,
        skillId: row.skill_id,
        skillSlug: row.skill_slug,
        skillName: row.skill_name,
        version: row.version,
        contentHash: row.content_hash,
        storagePath: row.storage_path,
        supportedProviderIds: row.supported_provider_ids,
        permissionsManifest: SkillPermissionsManifestSchema.parse(row.permissions_manifest),
      }));
    },

    async listLoadoutEntries(agentId) {
      const rows = await selectLoadoutRows(agentId).select<LoadoutEntryRow[]>();
      return rows.map((row) => ({
        skillId: row.skill_id,
        skillName: row.skill_name,
        version: row.version,
        supportedProviderIds: row.supported_provider_ids,
        permissionsManifest: SkillPermissionsManifestSchema.parse(row.permissions_manifest),
      }));
    },

    async listActiveAgentsAssignedSkill(skillId) {
      const rows = await database('agent_skill_assignments')
        .join('agents', 'agents.id', 'agent_skill_assignments.agent_id')
        .where('agent_skill_assignments.skill_id', skillId)
        .whereNull('agents.archived_at')
        .select<{ agent_id: string; agent_name: string; provider_id: string }[]>(
          'agents.id AS agent_id',
          'agents.name AS agent_name',
          'agents.provider_id',
        );
      return rows.map((row) => ({
        agentId: row.agent_id,
        agentName: row.agent_name,
        providerId: row.provider_id,
      }));
    },
  };
}
