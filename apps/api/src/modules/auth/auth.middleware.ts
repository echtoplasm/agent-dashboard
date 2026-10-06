/**
 * Middleware that identifies the signed-in user and enforces access rules.
 *
 * `createSessionMiddleware` runs on every request and attaches the user if
 * the session cookie is valid. `requireAuthentication` and `requireRole` then
 * guard routes. Role groups are named here so routes read like the
 * permission table in docs/decisions.md.
 */
import type { RequestHandler } from 'express';
import type { UserRole } from '@agent-dashboard/shared';
import { ForbiddenError, UnauthenticatedError } from '../../errors/app-errors.js';
import {
  findRequestAuthentication,
  getAuthenticatedUser,
  setRequestAuthentication,
} from '../../http/request-context.js';
import type { AuthService } from './auth.service.js';
import { clearSessionCookie, readSessionToken } from './session-cookie.js';
import type { SessionCookieSettings } from './session-cookie.js';

/** Who may perform each kind of action. */
export const ROLE_GROUPS = {
  /** Any signed-in user, including viewers. */
  EVERYONE: ['admin', 'operator', 'viewer'],
  /** Users who manage agents, skills and assignments. */
  OPERATORS: ['admin', 'operator'],
  /** Users who manage users, providers and sandbox profiles. */
  ADMINS: ['admin'],
} as const satisfies Record<string, readonly UserRole[]>;

/**
 * Creates middleware that validates the session cookie and records the user
 * on the request. Requests without a valid session continue anonymously; a
 * stale cookie is cleared.
 *
 * @param authService - Validates session tokens.
 * @param cookieSettings - Session cookie settings.
 * @returns Express middleware.
 */
export function createSessionMiddleware(
  authService: AuthService,
  cookieSettings: SessionCookieSettings,
): RequestHandler {
  return async (request, response, next) => {
    const sessionToken = readSessionToken(request, cookieSettings);
    if (sessionToken !== undefined) {
      const authenticatedSession = await authService.authenticateSessionToken(sessionToken);
      if (authenticatedSession === undefined) {
        clearSessionCookie(response, cookieSettings);
      } else {
        setRequestAuthentication(request, authenticatedSession);
      }
    }
    next();
  };
}

/**
 * Rejects requests without a valid session with 401.
 *
 * @param request - The current request.
 * @param _response - Unused.
 * @param next - Continues to the route.
 */
export const requireAuthentication: RequestHandler = (request, _response, next) => {
  if (findRequestAuthentication(request) === undefined) {
    throw new UnauthenticatedError();
  }
  next();
};

/**
 * Creates middleware that allows only the given roles; others get 403.
 * Mount after `requireAuthentication`.
 *
 * @param allowedRoles - Usually one of `ROLE_GROUPS`.
 * @returns Express middleware.
 *
 * @example
 * ```ts
 * router.post('/', requireRole(ROLE_GROUPS.OPERATORS), createAgentHandler);
 * ```
 */
export function requireRole(allowedRoles: readonly UserRole[]): RequestHandler {
  return (request, _response, next) => {
    if (!allowedRoles.includes(getAuthenticatedUser(request).role)) {
      throw new ForbiddenError();
    }
    next();
  };
}
