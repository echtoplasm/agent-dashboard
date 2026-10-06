/**
 * Builds the Express application.
 *
 * `createApp` only wires dependencies together and never opens a port or a
 * database connection itself, so tests can build a full app around a test
 * database.
 *
 * Middleware order matters and runs top to bottom:
 * security headers → request log → rate limit → CSRF check → JSON parsing →
 * session lookup → public routes → `requireAuthentication` → protected routes
 * → 404 → error handler.
 */
import express, { Router } from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import type { Knex } from 'knex';
import { createDataAccess } from './db/data-access.js';
import type { Logger } from './logger.js';
import { createCrossSiteRequestProtection } from './middleware/cross-site-request-protection.js';
import { createErrorHandler, createNotFoundHandler } from './middleware/error-handler.js';
import {
  DEFAULT_RATE_LIMIT_SETTINGS,
  createApiRateLimiter,
  createLoginRateLimiter,
} from './middleware/rate-limiters.js';
import type { RateLimitSettings } from './middleware/rate-limiters.js';
import { createRequestLogger } from './middleware/request-logger.js';
import { createAgentsRouter } from './modules/agents/agents.routes.js';
import { createAgentsService } from './modules/agents/agents.service.js';
import { createAuditRouter } from './modules/audit/audit.routes.js';
import { createAuditService } from './modules/audit/audit.service.js';
import { createSessionMiddleware, requireAuthentication } from './modules/auth/auth.middleware.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createHealthRepository } from './modules/health/health.repository.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createHealthService } from './modules/health/health.service.js';
import { createProvidersRouter } from './modules/providers/providers.routes.js';
import { createProvidersService } from './modules/providers/providers.service.js';
import { createSandboxProfilesRouter } from './modules/sandbox-profiles/sandbox-profiles.routes.js';
import { createSandboxProfilesService } from './modules/sandbox-profiles/sandbox-profiles.service.js';
import { createUsersRouter } from './modules/users/users.routes.js';
import { createUsersService } from './modules/users/users.service.js';

/** Largest JSON request body accepted by most routes. */
const MAX_JSON_BODY_SIZE = '100kb';

/** Settings that shape HTTP behaviour, usually taken from `ApiConfig`. */
export interface AppSettings {
  /** Browser origins allowed to make state-changing requests. */
  appOrigins: string[];
  /** Reverse proxies in front of the API whose forwarding headers are trusted. */
  trustProxyHops: number;
  /** Mark cookies Secure and use the `__Host-` prefix (production). */
  isSecureCookie: boolean;
  /** Overrides for the default rate limits, e.g. to relax them in tests. */
  rateLimits?: RateLimitSettings;
}

/** Everything the app needs from the outside world. */
export interface AppDependencies {
  /** Knex client connected as the restricted app role. */
  database: Knex;
  logger: Logger;
  settings: AppSettings;
}

/**
 * Creates the Express app with security middleware, routes and error handling.
 *
 * @param dependencies - Database client, logger and settings.
 * @returns A configured Express app, ready to `listen` or hand to Supertest.
 */
export function createApp(dependencies: AppDependencies): Express {
  const { database, logger, settings } = dependencies;
  const rateLimits = settings.rateLimits ?? DEFAULT_RATE_LIMIT_SETTINGS;
  const cookieSettings = { isSecure: settings.isSecureCookie };

  const dataAccess = createDataAccess(database);
  const authService = createAuthService({ dataAccess });
  const healthService = createHealthService({
    healthRepository: createHealthRepository(database),
    logger,
  });
  const usersService = createUsersService(dataAccess);
  const auditService = createAuditService(dataAccess);
  const providersService = createProvidersService(dataAccess);
  const sandboxProfilesService = createSandboxProfilesService(dataAccess);
  const agentsService = createAgentsService(dataAccess);

  const app = express();
  app.set('trust proxy', settings.trustProxyHops);

  app.use(helmet());
  app.use(createRequestLogger(logger));
  app.use(createApiRateLimiter(rateLimits));
  app.use(createCrossSiteRequestProtection(settings.appOrigins));
  app.use(express.json({ limit: MAX_JSON_BODY_SIZE }));
  app.use(createSessionMiddleware(authService, cookieSettings));

  app.use('/api/health', createHealthRouter(healthService));
  app.use(
    '/api/auth',
    createAuthRouter({
      authService,
      cookieSettings,
      loginRateLimiter: createLoginRateLimiter(rateLimits),
    }),
  );

  const protectedRoutes = Router();
  protectedRoutes.use(requireAuthentication);
  protectedRoutes.use('/users', createUsersRouter(usersService));
  protectedRoutes.use('/audit-log', createAuditRouter(auditService));
  protectedRoutes.use('/providers', createProvidersRouter(providersService));
  protectedRoutes.use('/sandbox-profiles', createSandboxProfilesRouter(sandboxProfilesService));
  protectedRoutes.use('/agents', createAgentsRouter(agentsService));
  app.use('/api', protectedRoutes);

  app.use(createNotFoundHandler());
  app.use(createErrorHandler(logger));

  return app;
}
