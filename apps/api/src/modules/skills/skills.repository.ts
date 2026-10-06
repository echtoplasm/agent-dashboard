/**
 * Data access for `skills` and `skill_supported_providers`.
 */
import type { DatabaseExecutor } from '../../db/database-executor.js';
import { isUniqueViolation, toIsoString, toNullableIsoString } from '../../db/row-mapping.js';
import { ConflictError } from '../../errors/app-errors.js';
import type { SkillRecord } from './skills.types.js';

interface SkillRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  created_by: string | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  supported_provider_ids: string[];
  published_versions: string[];
}

function mapSkillRow(row: SkillRow): SkillRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    supportedProviderIds: row.supported_provider_ids,
    publishedVersions: row.published_versions,
    createdBy: row.created_by,
    archivedAt: toNullableIsoString(row.archived_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

/** Fields needed to create a skill. */
export interface NewSkill {
  slug: string;
  name: string;
  description: string;
  createdBy: string | null;
}

/** Data access for skills. */
export interface SkillsRepository {
  listSkills(options: { isIncludingArchived: boolean }): Promise<SkillRecord[]>;
  findSkillById(skillId: string): Promise<SkillRecord | undefined>;
  /** @throws {ConflictError} If an active skill already has the slug. */
  insertSkill(newSkill: NewSkill): Promise<string>;
  updateSkillDetails(
    skillId: string,
    details: { name: string; description: string },
  ): Promise<void>;
  replaceSupportedProviders(skillId: string, providerIds: readonly string[]): Promise<void>;
  archiveSkill(skillId: string): Promise<void>;
}

/**
 * Creates the skills repository.
 *
 * @param database - A Knex client or transaction.
 * @returns The repository.
 */
export function createSkillsRepository(database: DatabaseExecutor): SkillsRepository {
  /** Skills with their provider ids and version strings aggregated into arrays. */
  function selectSkillsWithRelations() {
    return database('skills')
      .select<SkillRow[]>(
        'skills.*',
        database.raw(
          `coalesce((SELECT array_agg(provider_id ORDER BY provider_id)
             FROM skill_supported_providers WHERE skill_id = skills.id), '{}') AS supported_provider_ids`,
        ),
        database.raw(
          `coalesce((SELECT array_agg(version)
             FROM skill_versions WHERE skill_id = skills.id), '{}') AS published_versions`,
        ),
      )
      .orderBy('skills.name');
  }

  return {
    async listSkills({ isIncludingArchived }) {
      const query = selectSkillsWithRelations();
      if (!isIncludingArchived) {
        query.whereNull('skills.archived_at');
      }
      return (await query).map(mapSkillRow);
    },

    async findSkillById(skillId) {
      const [row] = await selectSkillsWithRelations().where('skills.id', skillId);
      return row === undefined ? undefined : mapSkillRow(row);
    },

    async insertSkill(newSkill) {
      try {
        const [row] = await database('skills')
          .insert({
            slug: newSkill.slug,
            name: newSkill.name,
            description: newSkill.description,
            created_by: newSkill.createdBy,
          })
          .returning<{ id: string }[]>('id');
        if (row === undefined) {
          throw new Error('Inserting a skill returned no row');
        }
        return row.id;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictError('An active skill with that slug already exists');
        }
        throw error;
      }
    },

    async updateSkillDetails(skillId, details) {
      await database('skills')
        .where({ id: skillId })
        .update({ name: details.name, description: details.description });
    },

    async replaceSupportedProviders(skillId, providerIds) {
      await database('skill_supported_providers').where({ skill_id: skillId }).delete();
      if (providerIds.length > 0) {
        await database('skill_supported_providers').insert(
          providerIds.map((providerId) => ({ skill_id: skillId, provider_id: providerId })),
        );
      }
    },

    async archiveSkill(skillId) {
      await database('skills').where({ id: skillId }).update({ archived_at: database.fn.now() });
    },
  };
}
