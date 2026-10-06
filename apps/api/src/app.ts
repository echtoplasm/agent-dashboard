/**
 * Builds the Express application.
 *
 * `createApp` only wires dependencies together and never opens a port or a
 * database connection itself, so tests can build a full app around a test
 * database or a stub.
 */
import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import type { Knex } from 'knex';
import type { Logger } from './logger.js';
import { createErrorHandler, createNotFoundHandler } from './middleware/error-handler.js';
import { createRequestLogger } from './middleware/request-logger.js';
import { createHealthRepository } from './modules/health/health.repository.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createHealthService } from './modules/health/health.service.js';

/** Largest JSON request body the API accepts. */
const MAX_JSON_BODY_SIZE = '100kb';

/** Everything the app needs from the outside world. */
export interface AppDependencies {
  /** Knex client connected as the restricted app role. */
  database: Knex;
  logger: Logger;
}

/**
 * Creates the Express app with security middleware, routes and error handling.
 *
 * @param dependencies - Database client and logger.
 * @returns A configured Express app, ready to `listen` or hand to Supertest.
 */
export function createApp(dependencies: AppDependencies): Express {
  const { database, logger } = dependencies;
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: MAX_JSON_BODY_SIZE }));
  app.use(createRequestLogger(logger));

  const healthService = createHealthService({
    healthRepository: createHealthRepository(database),
    logger,
  });
  app.use('/api/health', createHealthRouter(healthService));

  app.use(createNotFoundHandler());
  app.use(createErrorHandler(logger));

  return app;
}
