/**
 * Business rules for managing user accounts.
 *
 * Besides plain create and update, this module protects against lockout:
 * an admin cannot demote or deactivate themselves, and the last active admin
 * cannot be demoted or deactivated by anyone. Deactivating a user or
 * resetting their password signs them out everywhere.
 */
import type { CreateUserRequest, UpdateUserRequest, User } from '@agent-dashboard/shared';
import { CreateUserRequestSchema } from '@agent-dashboard/shared';
import type { DataAccess, Repositories } from '../../db/data-access.js';
import { ConflictError, NotFoundError } from '../../errors/app-errors.js';
import type { AuditContext } from '../audit/audit.types.js';
import { hashPassword } from '../auth/password-hashing.js';
import { toPublicUser } from './users.repository.js';
import type { UserRecord } from './users.types.js';

/** Operations on user accounts. */
export interface UsersService {
  listUsers(): Promise<User[]>;
  /** @throws {ConflictError} If the username or email is taken. */
  createUser(input: CreateUserRequest, context: AuditContext): Promise<User>;
  /**
   * @throws {NotFoundError} If the user does not exist.
   * @throws {ConflictError} If the change would lock admins out.
   */
  updateUser(userId: string, changes: UpdateUserRequest, context: AuditContext): Promise<User>;
  /** Sets a new password and signs the user out everywhere. */
  resetPassword(userId: string, newPassword: string, context: AuditContext): Promise<void>;
}

async function findExistingUser(repositories: Repositories, userId: string): Promise<UserRecord> {
  const userRecord = await repositories.users.findUserById(userId);
  if (userRecord === undefined) {
    throw new NotFoundError('User not found');
  }
  return userRecord;
}

/**
 * Refuses changes that would leave nobody able to administer the dashboard.
 *
 * @throws {ConflictError} If an admin targets themselves, or the last active admin would lose access.
 */
async function assertAdminAccessPreserved(
  repositories: Repositories,
  targetUser: UserRecord,
  changes: UpdateUserRequest,
  context: AuditContext,
): Promise<void> {
  const isLosingAdminAccess =
    targetUser.role === 'admin' &&
    targetUser.isActive &&
    ((changes.role !== undefined && changes.role !== 'admin') || changes.isActive === false);
  if (!isLosingAdminAccess) {
    return;
  }
  if (targetUser.id === context.actorUserId) {
    throw new ConflictError('You cannot remove your own admin access');
  }
  if ((await repositories.users.countActiveAdmins()) <= 1) {
    throw new ConflictError('At least one active admin must remain');
  }
}

/**
 * Creates the users service.
 *
 * @param dataAccess - Repositories and the transaction runner.
 * @returns The service.
 */
export function createUsersService(dataAccess: DataAccess): UsersService {
  return {
    async listUsers() {
      const userRecords = await dataAccess.repositories.users.listUsers();
      return userRecords.map(toPublicUser);
    },

    async createUser(input, context) {
      const validInput = CreateUserRequestSchema.parse(input);
      const passwordHash = await hashPassword(validInput.password);
      return dataAccess.runInTransaction(async (repositories) => {
        const createdUser = await repositories.users.insertUser({
          username: validInput.username,
          email: validInput.email,
          role: validInput.role,
          passwordHash,
        });
        await repositories.audit.insertAuditEntry(context, {
          action: 'user.created',
          targetType: 'user',
          targetId: createdUser.id,
          metadata: { username: createdUser.username, role: createdUser.role },
        });
        return toPublicUser(createdUser);
      });
    },

    async updateUser(userId, changes, context) {
      return dataAccess.runInTransaction(async (repositories) => {
        const targetUser = await findExistingUser(repositories, userId);
        await assertAdminAccessPreserved(repositories, targetUser, changes, context);

        const updatedUser = await repositories.users.updateUser(userId, changes);
        if (updatedUser === undefined) {
          throw new NotFoundError('User not found');
        }
        if (changes.isActive === false) {
          await repositories.sessions.deleteSessionsForUser(userId);
        }
        await repositories.audit.insertAuditEntry(context, {
          action: 'user.updated',
          targetType: 'user',
          targetId: userId,
          metadata: { changes },
        });
        return toPublicUser(updatedUser);
      });
    },

    async resetPassword(userId, newPassword, context) {
      const passwordHash = await hashPassword(newPassword);
      await dataAccess.runInTransaction(async (repositories) => {
        await findExistingUser(repositories, userId);
        await repositories.users.updateUser(userId, { passwordHash });
        await repositories.sessions.deleteSessionsForUser(userId);
        await repositories.audit.insertAuditEntry(context, {
          action: 'user.password_reset',
          targetType: 'user',
          targetId: userId,
          metadata: {},
        });
      });
    },
  };
}
