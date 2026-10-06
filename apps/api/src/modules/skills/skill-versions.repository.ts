/**
 * Data access for the immutable `skill_versions` table. The app role can
 * only insert and read; the database rejects updates (see D-009).
 */
import type { SkillPermissionsManifest } from '@agent-dashboard/shared';
import { SkillPermissionsManifestSchema } from '@agent-dashboard/shared';
import type { DatabaseExecutor } from '../../db/database-executor.js';
import { isUniqueViolation, toIsoString } from '../../db/row-mapping.js';
import { ConflictError } from '../../errors/app-errors.js';
import type { NewSkillVersion, SkillVersionRecord } from './skills.types.js';

interface SkillVersionRow {
  id: string;
  skill_id: string;
  version: string;
  content_hash: string;
  storage_path: string;
  permissions_manifest: unknown;
  changelog: string;
  published_by: string | null;
  published_at: Date;
}

function mapSkillVersionRow(row: SkillVersionRow): SkillVersionRecord {
  return {
    id: row.id,
    skillId: row.skill_id,
    version: row.version,
    contentHash: row.content_hash,
    storagePath: row.storage_path,
    // Parsed on read as well as on write, so a manifest stored by an older
    // format (or edited by hand) can never reach the rest of the app unchecked.
    permissionsManifest: SkillPermissionsManifestSchema.parse(row.permissions_manifest),
    changelog: row.changelog,
    publishedBy: row.published_by,
    publishedAt: toIsoString(row.published_at),
  };
}

/** Data access for skill versions. */
export interface SkillVersionsRepository {
  /** Versions of one skill, newest first. */
  listVersionsForSkill(skillId: string): Promise<SkillVersionRecord[]>;
  findVersionById(skillVersionId: string): Promise<SkillVersionRecord | undefined>;
  /** @throws {ConflictError} If the skill already has this version string. */
  insertVersion(newVersion: NewSkillVersion): Promise<SkillVersionRecord>;
}

/**
 * Creates the skill versions repository.
 *
 * @param database - A Knex client or transaction.
 * @returns The repository.
 */
export function createSkillVersionsRepository(database: DatabaseExecutor): SkillVersionsRepository {
  return {
    async listVersionsForSkill(skillId) {
      const rows = await database<SkillVersionRow>('skill_versions')
        .where({ skill_id: skillId })
        .orderBy('published_at', 'desc');
      return rows.map(mapSkillVersionRow);
    },

    async findVersionById(skillVersionId) {
      const row = await database<SkillVersionRow>('skill_versions')
        .where({ id: skillVersionId })
        .first();
      return row === undefined ? undefined : mapSkillVersionRow(row);
    },

    async insertVersion(newVersion) {
      const manifest: SkillPermissionsManifest = newVersion.permissionsManifest;
      try {
        const [row] = await database<SkillVersionRow>('skill_versions')
          .insert({
            skill_id: newVersion.skillId,
            version: newVersion.version,
            content_hash: newVersion.contentHash,
            storage_path: newVersion.storagePath,
            permissions_manifest: manifest,
            changelog: newVersion.changelog,
            published_by: newVersion.publishedBy,
          })
          .returning('*');
        if (row === undefined) {
          throw new Error('Inserting a skill version returned no row');
        }
        return mapSkillVersionRow(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError(`Version ${newVersion.version} has already been published`);
        }
        throw error;
      }
    },
  };
}
