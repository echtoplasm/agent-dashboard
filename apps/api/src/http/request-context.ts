/**
 * Per-request authentication state and audit context.
 *
 * State is kept in a WeakMap keyed by the request rather than on
 * `response.locals`, so it is fully typed without augmenting Express's global
 * types, and it is garbage-collected with the request.
 */
import type { Request } from 'express';
import type { UserRole } from '@agent-dashboard/shared';
import { UnauthenticatedError } from '../errors/app-errors.js';
import type { AuditContext } from '../modules/audit/audit.types.js';

/** The signed-in user behind a request. */
export interface AuthenticatedUser {
  id: string;
  username: string;
  role: UserRole;
}

/** What the session middleware learned about a request. */
export interface RequestAuthentication {
  user: AuthenticatedUser;
  sessionTokenHash: string;
}

const authenticationByRequest = new WeakMap<Request, RequestAuthentication>();

/**
 * Records that a request carries a valid session. Called by the session middleware only.
 *
 * @param request - The current request.
 * @param authentication - The session's user and token hash.
 */
export function setRequestAuthentication(
  request: Request,
  authentication: RequestAuthentication,
): void {
  authenticationByRequest.set(request, authentication);
}

/**
 * Returns the request's authentication, or undefined if it has no valid session.
 *
 * @param request - The current request.
 * @returns The authentication, if any.
 */
export function findRequestAuthentication(request: Request): RequestAuthentication | undefined {
  return authenticationByRequest.get(request);
}

/**
 * Returns the request's authentication. Use in routes mounted behind
 * `requireAuthentication`.
 *
 * @param request - The current request.
 * @returns The session's user and token hash.
 * @throws {UnauthenticatedError} If the request has no valid session.
 */
export function getRequestAuthentication(request: Request): RequestAuthentication {
  const authentication = authenticationByRequest.get(request);
  if (authentication === undefined) {
    throw new UnauthenticatedError();
  }
  return authentication;
}

/**
 * Returns the signed-in user. Use in routes mounted behind `requireAuthentication`.
 *
 * @param request - The current request.
 * @returns The authenticated user.
 * @throws {UnauthenticatedError} If the request has no valid session.
 */
export function getAuthenticatedUser(request: Request): AuthenticatedUser {
  return getRequestAuthentication(request).user;
}

/**
 * Builds the audit context (who and from where) for a request.
 *
 * @param request - The current request.
 * @returns The actor (if signed in), client IP and user agent.
 */
export function buildAuditContext(request: Request): AuditContext {
  return {
    actorUserId: authenticationByRequest.get(request)?.user.id ?? null,
    ipAddress: request.ip ?? null,
    userAgent: request.get('user-agent') ?? null,
  };
}
