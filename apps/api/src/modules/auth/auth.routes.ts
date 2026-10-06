/**
 * HTTP routes for signing in and out and managing your own password.
 *
 * - `POST /api/auth/login`: public, rate limited.
 * - `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/password`: signed in.
 */
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { ChangePasswordRequestSchema, LoginRequestSchema } from '@agent-dashboard/shared';
import { HTTP_STATUS } from '../../errors/app-errors.js';
import {
  buildAuditContext,
  getAuthenticatedUser,
  getRequestAuthentication,
} from '../../http/request-context.js';
import { parseRequestPart } from '../../http/request-validation.js';
import { requireAuthentication } from './auth.middleware.js';
import type { AuthService } from './auth.service.js';
import { clearSessionCookie, setSessionCookie } from './session-cookie.js';
import type { SessionCookieSettings } from './session-cookie.js';

/** Dependencies of the auth router. */
export interface AuthRouterDependencies {
  authService: AuthService;
  cookieSettings: SessionCookieSettings;
  /** Extra-strict rate limiter applied to the login route only. */
  loginRateLimiter: RequestHandler;
}

/**
 * Creates the auth router.
 *
 * @param dependencies - Service, cookie settings and the login rate limiter.
 * @returns A router to mount at `/api/auth`.
 */
export function createAuthRouter(dependencies: AuthRouterDependencies): Router {
  const { authService, cookieSettings, loginRateLimiter } = dependencies;
  const router = Router();

  router.post('/login', loginRateLimiter, async (request, response) => {
    const credentials = parseRequestPart(LoginRequestSchema, request.body);
    const loginResult = await authService.login(credentials, buildAuditContext(request));
    setSessionCookie(
      response,
      loginResult.sessionToken,
      loginResult.absoluteExpiresAt,
      cookieSettings,
    );
    response.status(HTTP_STATUS.OK).json({ user: loginResult.user });
  });

  router.post('/logout', requireAuthentication, async (request, response) => {
    const { sessionTokenHash } = getRequestAuthentication(request);
    await authService.logout(sessionTokenHash, buildAuditContext(request));
    clearSessionCookie(response, cookieSettings);
    response.status(HTTP_STATUS.NO_CONTENT).end();
  });

  router.get('/me', requireAuthentication, async (request, response) => {
    const user = await authService.getCurrentUser(getAuthenticatedUser(request).id);
    response.json({ user });
  });

  router.post('/password', requireAuthentication, async (request, response) => {
    const passwordChange = parseRequestPart(ChangePasswordRequestSchema, request.body);
    await authService.changePassword(
      getRequestAuthentication(request),
      passwordChange,
      buildAuditContext(request),
    );
    response.status(HTTP_STATUS.NO_CONTENT).end();
  });

  return router;
}
