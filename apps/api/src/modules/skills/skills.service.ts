/**
 * Business rules for skills and their published versions.
 *
 * - A skill's slug is permanent; its name, description and supported
 *   providers can change. Archived skills are read-only and accept no new
 *   versions.
 * - A provider cannot be removed from a skill while an active agent on that
 *   provider has the skill assigned, and an assigned skill cannot be archived.
 * - Admins may delete a skill only if it has no published versions; once a
 *   version exists, runs may have used it, so the skill can only be
 *   archived (D-026).
 * - Versions are immutable. A new version must have a higher semver than
 *   every version already published.
 * - Publishing writes files to staging first, then inserts the database row
 *   and moves the files into place inside one transaction. If the
 *   transaction fails after the move, the files are removed, so disk and
 *   database never disagree about which versions exist.
 */
import {
  compareSemanticVersions,
  type CreateSkillRequest,
  type PublishSkillVersionRequest,
  PublishSkillVersionRequestSchema,
  type Skill,
  type SkillVersionDetail,
  type SkillVersionSummary,
  type UpdateSkillRequest,
} from '@agent-dashboard/shared';
import type { DataAccess, Repositories } from '../../db/data-access.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/app-errors.js';
import type { AuditContext } from '../audit/audit.types.js';
import type { SkillStorage } from './skill-storage.js';
import { computeSkillContentHash } from './skill-storage.js';
import type { SkillRecord, SkillVersionRecord } from './skills.types.js';

/** Skill and skill version operations. */
export interface SkillsService {
  listSkills(options: { isIncludingArchived: boolean }): Promise<Skill[]>;
  /** @throws {NotFoundError} */
  getSkill(skillId: string): Promise<Skill>;
  /** @throws {ValidationError | ConflictError} */
  createSkill(input: CreateSkillRequest, context: AuditContext): Promise<Skill>;
  /** @throws {NotFoundError | ValidationError | ConflictError} */
  updateSkill(skillId: string, changes: UpdateSkillRequest, context: AuditContext): Promise<Skill>;
  /** @throws {NotFoundError | ConflictError} */
  archiveSkill(skillId: string, context: AuditContext): Promise<Skill>;
  /** @throws {NotFoundError | ConflictError} If the skill has published versions. */
  deleteSkill(skillId: string, context: AuditContext): Promise<void>;
  /** @throws {NotFoundError} If the skill does not exist. */
  listVersions(skillId: string): Promise<SkillVersionSummary[]>;
  /** Returns a version with its files. @throws {NotFoundError} */
  getVersionDetail(skillVersionId: string): Promise<SkillVersionDetail>;
  /** @throws {NotFoundError | ConflictError} */
  publishVersion(
    skillId: string,
    input: PublishSkillVersionRequest,
    context: AuditContext,
  ): Promise<SkillVersionSummary>;
}

/** Dependencies of the skills service. */
export interface SkillsServiceDependencies {
  dataAccess: DataAccess;
  skillStorage: SkillStorage;
}

/**
 * Returns the highest version by semver precedence.
 *
 * @param versions - Published version strings.
 * @returns The highest, or null when there are none.
 */
export function findLatestVersion(versions: readonly string[]): string | null {
  return [...versions].sort(compareSemanticVersions).at(-1) ?? null;
}

function toSkill(skillRecord: SkillRecord): Skill {
  const { publishedVersions, ...skill } = skillRecord;
  return { ...skill, latestVersion: findLatestVersion(publishedVersions) };
}

function toVersionSummary(versionRecord: SkillVersionRecord): SkillVersionSummary {
  const { storagePath: _storagePath, ...summary } = versionRecord;
  return summary;
}

/** Builds the storage path for a version: `<skillId>/<version>`. */
function buildStoragePath(skillId: string, version: string): string {
  return `${skillId}/${version}`;
}

async function findSkill(repositories: Repositories, skillId: string): Promise<SkillRecord> {
  const skillRecord = await repositories.skills.findSkillById(skillId);
  if (skillRecord === undefined) {
    throw new NotFoundError('Skill not found');
  }
  return skillRecord;
}

async function findEditableSkill(
  repositories: Repositories,
  skillId: string,
): Promise<SkillRecord> {
  const skillRecord = await findSkill(repositories, skillId);
  if (skillRecord.archivedAt !== null) {
    throw new ConflictError('Archived skills cannot be changed');
  }
  return skillRecord;
}

/**
 * Checks that every provider id exists.
 *
 * @throws {ValidationError} Naming the unknown ids.
 */
async function assertProvidersExist(
  repositories: Repositories,
  providerIds: readonly string[],
): Promise<void> {
  const foundProviders = await repositories.providers.findProvidersByIds(providerIds);
  const foundIds = new Set(foundProviders.map((provider) => provider.id));
  const unknownIds = providerIds.filter((providerId) => !foundIds.has(providerId));
  if (unknownIds.length > 0) {
    throw new ValidationError([
      { path: 'supportedProviderIds', message: `Unknown provider(s): ${unknownIds.join(', ')}` },
    ]);
  }
}

/**
 * Refuses to drop a provider that active agents with this skill depend on.
 *
 * @throws {ConflictError} Naming the affected agents.
 */
async function assertProviderRemovalSafe(
  repositories: Repositories,
  skillId: string,
  newProviderIds: readonly string[],
): Promise<void> {
  const assignedAgents = await repositories.assignments.listActiveAgentsAssignedSkill(skillId);
  const strandedAgentNames = assignedAgents
    .filter((agent) => !newProviderIds.includes(agent.providerId))
    .map((agent) => agent.agentName);
  if (strandedAgentNames.length > 0) {
    throw new ConflictError(
      `Agents using this skill need the removed provider: ${strandedAgentNames.join(', ')}`,
    );
  }
}

/**
 * Refuses to archive a skill that active agents still have assigned.
 *
 * @throws {ConflictError} Naming the affected agents.
 */
async function assertSkillUnassigned(repositories: Repositories, skillId: string): Promise<void> {
  const assignedAgents = await repositories.assignments.listActiveAgentsAssignedSkill(skillId);
  if (assignedAgents.length > 0) {
    const agentNames = assignedAgents.map((agent) => agent.agentName).join(', ');
    throw new ConflictError(`Unassign this skill from these agents first: ${agentNames}`);
  }
}

/**
 * Checks that a new version is higher than every published version.
 *
 * @throws {ConflictError} If it is not.
 */
function assertVersionIncreases(skillRecord: SkillRecord, newVersion: string): void {
  const latestVersion = findLatestVersion(skillRecord.publishedVersions);
  if (latestVersion !== null && compareSemanticVersions(newVersion, latestVersion) <= 0) {
    throw new ConflictError(`Version must be higher than the latest published (${latestVersion})`);
  }
}

/**
 * Creates the skills service.
 *
 * @param dependencies - Data access and skill file storage.
 * @returns The service.
 */
export function createSkillsService(dependencies: SkillsServiceDependencies): SkillsService {
  const { dataAccess, skillStorage } = dependencies;

  async function getSkillFrom(repositories: Repositories, skillId: string): Promise<Skill> {
    return toSkill(await findSkill(repositories, skillId));
  }

  return {
    async listSkills(options) {
      const skillRecords = await dataAccess.repositories.skills.listSkills(options);
      return skillRecords.map(toSkill);
    },

    getSkill: (skillId) => getSkillFrom(dataAccess.repositories, skillId),

    async createSkill(input, context) {
      return dataAccess.runInTransaction(async (repositories) => {
        await assertProvidersExist(repositories, input.supportedProviderIds);
        const skillId = await repositories.skills.insertSkill({
          slug: input.slug,
          name: input.name,
          description: input.description,
          createdBy: context.actorUserId,
        });
        await repositories.skills.replaceSupportedProviders(skillId, input.supportedProviderIds);
        await repositories.audit.insertAuditEntry(context, {
          action: 'skill.created',
          targetType: 'skill',
          targetId: skillId,
          metadata: { slug: input.slug },
        });
        return getSkillFrom(repositories, skillId);
      });
    },

    async updateSkill(skillId, changes, context) {
      return dataAccess.runInTransaction(async (repositories) => {
        const currentSkill = await findEditableSkill(repositories, skillId);
        await repositories.skills.updateSkillDetails(skillId, {
          name: changes.name ?? currentSkill.name,
          description: changes.description ?? currentSkill.description,
        });
        if (changes.supportedProviderIds !== undefined) {
          await assertProvidersExist(repositories, changes.supportedProviderIds);
          await assertProviderRemovalSafe(repositories, skillId, changes.supportedProviderIds);
          await repositories.skills.replaceSupportedProviders(
            skillId,
            changes.supportedProviderIds,
          );
        }
        await repositories.audit.insertAuditEntry(context, {
          action: 'skill.updated',
          targetType: 'skill',
          targetId: skillId,
          metadata: { changes },
        });
        return getSkillFrom(repositories, skillId);
      });
    },

    async archiveSkill(skillId, context) {
      return dataAccess.runInTransaction(async (repositories) => {
        await findEditableSkill(repositories, skillId);
        await assertSkillUnassigned(repositories, skillId);
        await repositories.skills.archiveSkill(skillId);
        await repositories.audit.insertAuditEntry(context, {
          action: 'skill.archived',
          targetType: 'skill',
          targetId: skillId,
          metadata: {},
        });
        return getSkillFrom(repositories, skillId);
      });
    },

    async deleteSkill(skillId, context) {
      await dataAccess.runInTransaction(async (repositories) => {
        const skillRecord = await findSkill(repositories, skillId);
        if (skillRecord.publishedVersions.length > 0) {
          throw new ConflictError(
            'Skills with published versions can only be archived, so run history stays traceable',
          );
        }
        await repositories.skills.deleteSkill(skillId);
        await repositories.audit.insertAuditEntry(context, {
          action: 'skill.deleted',
          targetType: 'skill',
          targetId: skillId,
          metadata: { slug: skillRecord.slug },
        });
      });
    },

    async listVersions(skillId) {
      await findSkill(dataAccess.repositories, skillId);
      const versionRecords =
        await dataAccess.repositories.skillVersions.listVersionsForSkill(skillId);
      return versionRecords.map(toVersionSummary);
    },

    async getVersionDetail(skillVersionId) {
      const versionRecord =
        await dataAccess.repositories.skillVersions.findVersionById(skillVersionId);
      if (versionRecord === undefined) {
        throw new NotFoundError('Skill version not found');
      }
      const files = await skillStorage.readVersionFiles(
        versionRecord.storagePath,
        versionRecord.contentHash,
      );
      return { ...toVersionSummary(versionRecord), files };
    },

    async publishVersion(skillId, input, context) {
      const validInput = PublishSkillVersionRequestSchema.parse(input);
      const skillRecord = await findEditableSkill(dataAccess.repositories, skillId);
      assertVersionIncreases(skillRecord, validInput.version);

      const storagePath = buildStoragePath(skillId, validInput.version);
      const stagedFiles = await skillStorage.stageFiles(validInput.files);
      // An object rather than a local boolean so TypeScript sees the update
      // made inside the transaction callback.
      const publishProgress = { isMovedIntoPlace: false };
      try {
        return await dataAccess.runInTransaction(async (repositories) => {
          const versionRecord = await repositories.skillVersions.insertVersion({
            skillId,
            version: validInput.version,
            contentHash: computeSkillContentHash(validInput.files),
            storagePath,
            permissionsManifest: validInput.permissionsManifest,
            changelog: validInput.changelog,
            publishedBy: context.actorUserId,
          });
          await repositories.audit.insertAuditEntry(context, {
            action: 'skill_version.published',
            targetType: 'skill_version',
            targetId: versionRecord.id,
            metadata: {
              skillId,
              version: versionRecord.version,
              contentHash: versionRecord.contentHash,
            },
          });
          // Last step inside the transaction: if the move fails, the insert rolls back.
          await skillStorage.moveIntoPlace(stagedFiles, storagePath);
          publishProgress.isMovedIntoPlace = true;
          return toVersionSummary(versionRecord);
        });
      } catch (error) {
        if (publishProgress.isMovedIntoPlace) {
          await skillStorage.removeVersionFiles(storagePath);
        }
        throw error;
      } finally {
        await skillStorage.discardStaged(stagedFiles);
      }
    },
  };
}
