/**
 * Business rules for sandbox profiles.
 *
 * - Allowed hosts are only meaningful with network access on, so a profile
 *   with hosts but no network is rejected.
 * - Archived profiles are read-only, and a profile still used by an active
 *   agent cannot be archived.
 * - Narrowing a profile must not strand skills already assigned to agents
 *   using it. That check is added together with assignments.
 */
import type {
  CreateSandboxProfileRequest,
  SandboxProfile,
  UpdateSandboxProfileRequest,
} from '@agent-dashboard/shared';
import type { DataAccess, Repositories } from '../../db/data-access.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/app-errors.js';
import type { AuditContext } from '../audit/audit.types.js';
import { applyChanges } from '../../utils/apply-changes.js';
import type { SandboxProfileFields } from './sandbox-profiles.types.js';

/** Sandbox profile operations. */
export interface SandboxProfilesService {
  listSandboxProfiles(options: { isIncludingArchived: boolean }): Promise<SandboxProfile[]>;
  /** @throws {NotFoundError} */
  getSandboxProfile(profileId: string): Promise<SandboxProfile>;
  /** @throws {ValidationError | ConflictError} */
  createSandboxProfile(
    input: CreateSandboxProfileRequest,
    context: AuditContext,
  ): Promise<SandboxProfile>;
  /** @throws {NotFoundError | ValidationError | ConflictError} */
  updateSandboxProfile(
    profileId: string,
    changes: UpdateSandboxProfileRequest,
    context: AuditContext,
  ): Promise<SandboxProfile>;
  /** @throws {NotFoundError | ConflictError} If the profile is in use or already archived. */
  archiveSandboxProfile(profileId: string, context: AuditContext): Promise<SandboxProfile>;
}

/**
 * Rejects allowed hosts on a profile without network access.
 *
 * @throws {ValidationError} If the combination is inconsistent.
 */
function assertNetworkSettingsConsistent(fields: SandboxProfileFields): void {
  if (!fields.isNetworkAllowed && fields.allowedNetworkHosts.length > 0) {
    throw new ValidationError([
      {
        path: 'allowedNetworkHosts',
        message: 'Allowed hosts require isNetworkAllowed to be true',
      },
    ]);
  }
}

/**
 * Loads a profile that may still be changed.
 *
 * @throws {NotFoundError} If it does not exist.
 * @throws {ConflictError} If it is archived.
 */
async function findEditableProfile(
  repositories: Repositories,
  profileId: string,
): Promise<SandboxProfile> {
  const profile = await repositories.sandboxProfiles.findSandboxProfileById(profileId);
  if (profile === undefined) {
    throw new NotFoundError('Sandbox profile not found');
  }
  if (profile.archivedAt !== null) {
    throw new ConflictError('Archived sandbox profiles cannot be changed');
  }
  return profile;
}

function toProfileFields(profile: SandboxProfile): SandboxProfileFields {
  const {
    id: _id,
    archivedAt: _archivedAt,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...fields
  } = profile;
  return fields;
}

/**
 * Creates the sandbox profiles service.
 *
 * @param dataAccess - Repositories and the transaction runner.
 * @returns The service.
 */
export function createSandboxProfilesService(dataAccess: DataAccess): SandboxProfilesService {
  return {
    listSandboxProfiles: (options) =>
      dataAccess.repositories.sandboxProfiles.listSandboxProfiles(options),

    async getSandboxProfile(profileId) {
      const profile =
        await dataAccess.repositories.sandboxProfiles.findSandboxProfileById(profileId);
      if (profile === undefined) {
        throw new NotFoundError('Sandbox profile not found');
      }
      return profile;
    },

    async createSandboxProfile(input, context) {
      assertNetworkSettingsConsistent(input);
      return dataAccess.runInTransaction(async (repositories) => {
        const createdProfile = await repositories.sandboxProfiles.insertSandboxProfile(input);
        await repositories.audit.insertAuditEntry(context, {
          action: 'sandbox_profile.created',
          targetType: 'sandbox_profile',
          targetId: createdProfile.id,
          metadata: { name: createdProfile.name },
        });
        return createdProfile;
      });
    },

    async updateSandboxProfile(profileId, changes, context) {
      return dataAccess.runInTransaction(async (repositories) => {
        const currentProfile = await findEditableProfile(repositories, profileId);
        const mergedFields = applyChanges(toProfileFields(currentProfile), changes);
        assertNetworkSettingsConsistent(mergedFields);

        const updatedProfile = await repositories.sandboxProfiles.updateSandboxProfile(
          profileId,
          mergedFields,
        );
        if (updatedProfile === undefined) {
          throw new NotFoundError('Sandbox profile not found');
        }
        await repositories.audit.insertAuditEntry(context, {
          action: 'sandbox_profile.updated',
          targetType: 'sandbox_profile',
          targetId: profileId,
          metadata: { changes },
        });
        return updatedProfile;
      });
    },

    async archiveSandboxProfile(profileId, context) {
      return dataAccess.runInTransaction(async (repositories) => {
        await findEditableProfile(repositories, profileId);
        const agentCount =
          await repositories.sandboxProfiles.countActiveAgentsUsingProfile(profileId);
        if (agentCount > 0) {
          throw new ConflictError(
            `This profile is used by ${agentCount} active agent(s); move or archive them first`,
          );
        }

        const archivedProfile = await repositories.sandboxProfiles.archiveSandboxProfile(profileId);
        if (archivedProfile === undefined) {
          throw new NotFoundError('Sandbox profile not found');
        }
        await repositories.audit.insertAuditEntry(context, {
          action: 'sandbox_profile.archived',
          targetType: 'sandbox_profile',
          targetId: profileId,
          metadata: {},
        });
        return archivedProfile;
      });
    },
  };
}
