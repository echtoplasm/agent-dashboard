/**
 * Signing in and out, session validation, and password changes.
 *
 * Session tokens are 32 random bytes sent to the browser in an HttpOnly
 * cookie. Only their SHA-256 hash is stored. A session lasts until it has
 * been idle for 8 hours or is 7 days old, whichever comes first. Every login
 * attempt is audited, successful or not. See D-017 in docs/decisions.md.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { ChangePasswordRequest, LoginRequest, User } from '@agent-dashboard/shared';
import type { DataAccess } from '../../db/data-access.js';
import { NotFoundError, UnauthenticatedError, ValidationError } from '../../errors/app-errors.js';
import type { RequestAuthentication } from '../../http/request-context.js';
import type { AuditContext } from '../audit/audit.types.js';
import { toPublicUser } from '../users/users.repository.js';
import type { UserRecord } from '../users/users.types.js';
import { hashPassword, verifyAgainstDummyHash, verifyPassword } from './password-hashing.js';

const MILLISECONDS_PER_MINUTE = 60 * 1000;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;

/** How long sessions live. */
export const SESSION_TIMING = {
  /** Signed out after this long without a request. */
  IDLE_TIMEOUT_MS: 8 * MILLISECONDS_PER_HOUR,
  /** Signed out this long after signing in, however active. */
  ABSOLUTE_LIFETIME_MS: 7 * MILLISECONDS_PER_DAY,
  /** Minimum gap between `last_seen_at` writes, to avoid a write on every request. */
  TOUCH_INTERVAL_MS: MILLISECONDS_PER_MINUTE,
} as const;

const SESSION_TOKEN_BYTES = 32;
const MAX_AUDITED_USERNAME_LENGTH = 64;

/** Same message for every failure, so it never reveals whether a username exists. */
const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password';

/** Why a login failed, recorded in the audit log for admins only. */
type LoginFailureReason = 'unknown_user' | 'inactive_user' | 'no_password' | 'wrong_password';

/** A successful login. */
export interface LoginResult {
  user: User;
  /** Raw token for the cookie. Never stored or logged. */
  sessionToken: string;
  absoluteExpiresAt: Date;
}

/** A request's validated session. */
export type AuthenticatedSession = RequestAuthentication;

/** Authentication operations. */
export interface AuthService {
  /** @throws {UnauthenticatedError} For any bad username, password or inactive account. */
  login(credentials: LoginRequest, context: AuditContext): Promise<LoginResult>;
  /** Returns the session's user, or undefined if the token is unknown or expired. */
  authenticateSessionToken(sessionToken: string): Promise<AuthenticatedSession | undefined>;
  logout(sessionTokenHash: string, context: AuditContext): Promise<void>;
  /** @throws {NotFoundError} If the user no longer exists. */
  getCurrentUser(userId: string): Promise<User>;
  /**
   * Changes the signed-in user's password and signs out their other sessions.
   *
   * @throws {ValidationError} If the current password is wrong.
   */
  changePassword(
    session: AuthenticatedSession,
    request: ChangePasswordRequest,
    context: AuditContext,
  ): Promise<void>;
}

/** Dependencies of the auth service. */
export interface AuthServiceDependencies {
  dataAccess: DataAccess;
  /** Current time. Defaults to `new Date()`; injectable for tests. */
  getCurrentTime?: () => Date;
}

/**
 * Hashes a session token for storage and lookup.
 *
 * @param sessionToken - The raw token from the cookie.
 * @returns Lowercase hex SHA-256 digest.
 */
export function hashSessionToken(sessionToken: string): string {
  return createHash('sha256').update(sessionToken).digest('hex');
}

function findLoginFailureReason(userRecord: UserRecord | undefined): LoginFailureReason | null {
  if (userRecord === undefined) return 'unknown_user';
  if (!userRecord.isActive) return 'inactive_user';
  if (userRecord.passwordHash === null) return 'no_password';
  return null;
}

/**
 * Creates the auth service.
 *
 * @param dependencies - Data access and an optional clock.
 * @returns The service.
 */
export function createAuthService(dependencies: AuthServiceDependencies): AuthService {
  const { dataAccess, getCurrentTime = () => new Date() } = dependencies;

  async function recordFailedLogin(
    username: string,
    reason: LoginFailureReason,
    context: AuditContext,
  ): Promise<never> {
    await dataAccess.repositories.audit.insertAuditEntry(context, {
      action: 'auth.login_failed',
      targetType: null,
      targetId: null,
      metadata: { username: username.slice(0, MAX_AUDITED_USERNAME_LENGTH), reason },
    });
    throw new UnauthenticatedError(INVALID_CREDENTIALS_MESSAGE);
  }

  async function startSession(userRecord: UserRecord, context: AuditContext) {
    const now = getCurrentTime();
    const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
    const absoluteExpiresAt = new Date(now.getTime() + SESSION_TIMING.ABSOLUTE_LIFETIME_MS);

    const signedInUser = await dataAccess.runInTransaction(async (repositories) => {
      await repositories.sessions.deleteExpiredSessions(now);
      await repositories.sessions.insertSession({
        tokenHash: hashSessionToken(sessionToken),
        userId: userRecord.id,
        idleExpiresAt: new Date(now.getTime() + SESSION_TIMING.IDLE_TIMEOUT_MS),
        absoluteExpiresAt,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      const updatedUser = await repositories.users.updateUser(userRecord.id, { lastLoginAt: now });
      await repositories.audit.insertAuditEntry(
        { ...context, actorUserId: userRecord.id },
        {
          action: 'auth.login_succeeded',
          targetType: 'user',
          targetId: userRecord.id,
          metadata: {},
        },
      );
      return updatedUser ?? userRecord;
    });

    return { user: toPublicUser(signedInUser), sessionToken, absoluteExpiresAt };
  }

  return {
    async login(credentials, context) {
      const userRecord = await dataAccess.repositories.users.findUserByUsername(
        credentials.username,
      );
      const failureReason = findLoginFailureReason(userRecord);
      const passwordHash = userRecord?.passwordHash ?? null;
      if (failureReason !== null || userRecord === undefined || passwordHash === null) {
        // Spend the same time as a real check so timing doesn't reveal the outcome.
        await verifyAgainstDummyHash(credentials.password);
        return recordFailedLogin(credentials.username, failureReason ?? 'no_password', context);
      }

      const isPasswordCorrect = await verifyPassword(credentials.password, passwordHash);
      if (!isPasswordCorrect) {
        return recordFailedLogin(credentials.username, 'wrong_password', context);
      }
      return startSession(userRecord, context);
    },

    async authenticateSessionToken(sessionToken) {
      const now = getCurrentTime();
      const sessionTokenHash = hashSessionToken(sessionToken);
      const activeSession = await dataAccess.repositories.sessions.findActiveSession(
        sessionTokenHash,
        now,
      );
      if (activeSession === undefined) {
        return undefined;
      }

      const isTouchDue =
        now.getTime() - activeSession.lastSeenAt.getTime() >= SESSION_TIMING.TOUCH_INTERVAL_MS;
      if (isTouchDue) {
        const idleExpiresAt = new Date(
          Math.min(
            now.getTime() + SESSION_TIMING.IDLE_TIMEOUT_MS,
            activeSession.absoluteExpiresAt.getTime(),
          ),
        );
        await dataAccess.repositories.sessions.touchSession(sessionTokenHash, now, idleExpiresAt);
      }

      return {
        user: {
          id: activeSession.userId,
          username: activeSession.username,
          role: activeSession.role,
        },
        sessionTokenHash,
      };
    },

    async logout(sessionTokenHash, context) {
      await dataAccess.runInTransaction(async (repositories) => {
        await repositories.sessions.deleteSession(sessionTokenHash);
        await repositories.audit.insertAuditEntry(context, {
          action: 'auth.logged_out',
          targetType: 'user',
          targetId: context.actorUserId,
          metadata: {},
        });
      });
    },

    async getCurrentUser(userId) {
      const userRecord = await dataAccess.repositories.users.findUserById(userId);
      if (userRecord === undefined) {
        throw new NotFoundError('User not found');
      }
      return toPublicUser(userRecord);
    },

    async changePassword(session, request, context) {
      const userRecord = await dataAccess.repositories.users.findUserById(session.user.id);
      const passwordHash = userRecord?.passwordHash ?? null;
      const isCurrentPasswordCorrect =
        passwordHash !== null && (await verifyPassword(request.currentPassword, passwordHash));
      if (!isCurrentPasswordCorrect) {
        throw new ValidationError([
          { path: 'currentPassword', message: 'Current password is incorrect' },
        ]);
      }

      const newPasswordHash = await hashPassword(request.newPassword);
      await dataAccess.runInTransaction(async (repositories) => {
        await repositories.users.updateUser(session.user.id, { passwordHash: newPasswordHash });
        await repositories.sessions.deleteOtherSessionsForUser(
          session.user.id,
          session.sessionTokenHash,
        );
        await repositories.audit.insertAuditEntry(context, {
          action: 'auth.password_changed',
          targetType: 'user',
          targetId: session.user.id,
          metadata: {},
        });
      });
    },
  };
}
