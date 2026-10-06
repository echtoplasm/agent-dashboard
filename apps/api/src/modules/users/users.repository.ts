/**
 * Data access for `users`. Maps snake_case rows to camelCase records.
 */
import type { User, UserRole } from '@agent-dashboard/shared';
import { ConflictError } from '../../errors/app-errors.js';
import type { DatabaseExecutor } from '../../db/database-executor.js';
import { isUniqueViolation, toIsoString, toNullableIsoString } from '../../db/row-mapping.js';
import type { NewUser, UserChanges, UserRecord } from './users.types.js';

interface UserRow {
  id: string;
  username: string;
  email: string | null;
  password_hash: string | null;
  role: UserRole;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapUserRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    isActive: row.is_active,
    lastLoginAt: toNullableIsoString(row.last_login_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

/**
 * Removes the password hash from a stored user.
 *
 * @param userRecord - A user as stored.
 * @returns The user as the API may return it.
 */
export function toPublicUser(userRecord: UserRecord): User {
  const { passwordHash: _passwordHash, ...publicUser } = userRecord;
  return publicUser;
}

function mapUserChanges(changes: UserChanges): Partial<UserRow> {
  const columns: Partial<UserRow> = {};
  if (changes.email !== undefined) columns.email = changes.email;
  if (changes.role !== undefined) columns.role = changes.role;
  if (changes.isActive !== undefined) columns.is_active = changes.isActive;
  if (changes.passwordHash !== undefined) columns.password_hash = changes.passwordHash;
  if (changes.lastLoginAt !== undefined) columns.last_login_at = changes.lastLoginAt;
  return columns;
}

/** Data access for users. */
export interface UsersRepository {
  findUserById(userId: string): Promise<UserRecord | undefined>;
  /** Looks a user up by username, ignoring case. */
  findUserByUsername(username: string): Promise<UserRecord | undefined>;
  listUsers(): Promise<UserRecord[]>;
  /** @throws {ConflictError} If the username or email is already taken. */
  insertUser(newUser: NewUser): Promise<UserRecord>;
  /** @throws {ConflictError} If the new email is already taken. */
  updateUser(userId: string, changes: UserChanges): Promise<UserRecord | undefined>;
  countActiveAdmins(): Promise<number>;
}

/**
 * Creates the users repository.
 *
 * @param database - A Knex client or transaction.
 * @returns The repository.
 */
export function createUsersRepository(database: DatabaseExecutor): UsersRepository {
  async function rethrowDuplicate(operation: () => Promise<UserRecord | undefined>) {
    try {
      return await operation();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('That username or email is already in use');
      }
      throw error;
    }
  }

  return {
    async findUserById(userId) {
      const row = await database<UserRow>('users').where({ id: userId }).first();
      return row === undefined ? undefined : mapUserRow(row);
    },

    async findUserByUsername(username) {
      const row = await database<UserRow>('users')
        .whereRaw('lower(username) = lower(?)', [username])
        .first();
      return row === undefined ? undefined : mapUserRow(row);
    },

    async listUsers() {
      const rows = await database<UserRow>('users').orderBy('username');
      return rows.map(mapUserRow);
    },

    async insertUser(newUser) {
      const insertedUser = await rethrowDuplicate(async () => {
        const [row] = await database<UserRow>('users')
          .insert({
            username: newUser.username,
            email: newUser.email,
            role: newUser.role,
            password_hash: newUser.passwordHash,
          })
          .returning('*');
        return row === undefined ? undefined : mapUserRow(row);
      });
      if (insertedUser === undefined) {
        throw new Error('Inserting a user returned no row');
      }
      return insertedUser;
    },

    async updateUser(userId, changes) {
      return rethrowDuplicate(async () => {
        const [row] = await database<UserRow>('users')
          .where({ id: userId })
          .update(mapUserChanges(changes))
          .returning('*');
        return row === undefined ? undefined : mapUserRow(row);
      });
    },

    async countActiveAdmins() {
      const [result] = await database('users')
        .where({ role: 'admin', is_active: true })
        .count<{ count: number }[]>({ count: '*' });
      return result?.count ?? 0;
    },
  };
}
