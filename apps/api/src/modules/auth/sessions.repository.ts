/**
 * Data access for `sessions`. Rows are keyed by the SHA-256 of the session
 * token; the token itself is never stored.
 */
import type { UserRole } from '@agent-dashboard/shared';
import type { DatabaseExecutor } from '../../db/database-executor.js';

/** A session about to be stored. */
export interface NewSession {
  tokenHash: string;
  userId: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

/** A live session joined with the minimum user data needed to authorize requests. */
export interface ActiveSession {
  tokenHash: string;
  userId: string;
  username: string;
  role: UserRole;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
}

interface ActiveSessionRow {
  token_hash: string;
  user_id: string;
  username: string;
  role: UserRole;
  last_seen_at: Date;
  absolute_expires_at: Date;
}

const MAX_USER_AGENT_LENGTH = 500;

/** Data access for sessions. */
export interface SessionsRepository {
  insertSession(newSession: NewSession): Promise<void>;
  /**
   * Finds a session that has not expired and whose user is still active.
   *
   * @returns The session, or undefined if it is missing, expired or its user is deactivated.
   */
  findActiveSession(tokenHash: string, now: Date): Promise<ActiveSession | undefined>;
  /** Records activity and extends the idle expiry. */
  touchSession(tokenHash: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Signs a user out everywhere. */
  deleteSessionsForUser(userId: string): Promise<void>;
  /** Removes expired rows and returns how many were deleted. */
  deleteExpiredSessions(now: Date): Promise<number>;
}

/**
 * Creates the sessions repository.
 *
 * @param database - A Knex client or transaction.
 * @returns The repository.
 */
export function createSessionsRepository(database: DatabaseExecutor): SessionsRepository {
  return {
    async insertSession(newSession) {
      await database('sessions').insert({
        token_hash: newSession.tokenHash,
        user_id: newSession.userId,
        idle_expires_at: newSession.idleExpiresAt,
        absolute_expires_at: newSession.absoluteExpiresAt,
        ip_address: newSession.ipAddress,
        user_agent: newSession.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
      });
    },

    async findActiveSession(tokenHash, now) {
      const row = await database('sessions')
        .join('users', 'users.id', 'sessions.user_id')
        .where('sessions.token_hash', tokenHash)
        .andWhere('sessions.idle_expires_at', '>', now)
        .andWhere('sessions.absolute_expires_at', '>', now)
        .andWhere('users.is_active', true)
        .first<ActiveSessionRow | undefined>(
          'sessions.token_hash',
          'sessions.user_id',
          'users.username',
          'users.role',
          'sessions.last_seen_at',
          'sessions.absolute_expires_at',
        );
      if (row === undefined) {
        return undefined;
      }
      return {
        tokenHash: row.token_hash,
        userId: row.user_id,
        username: row.username,
        role: row.role,
        lastSeenAt: row.last_seen_at,
        absoluteExpiresAt: row.absolute_expires_at,
      };
    },

    async touchSession(tokenHash, lastSeenAt, idleExpiresAt) {
      await database('sessions')
        .where({ token_hash: tokenHash })
        .update({ last_seen_at: lastSeenAt, idle_expires_at: idleExpiresAt });
    },

    async deleteSession(tokenHash) {
      await database('sessions').where({ token_hash: tokenHash }).delete();
    },

    async deleteSessionsForUser(userId) {
      await database('sessions').where({ user_id: userId }).delete();
    },

    async deleteExpiredSessions(now) {
      return database('sessions')
        .where('idle_expires_at', '<=', now)
        .orWhere('absolute_expires_at', '<=', now)
        .delete();
    },
  };
}
