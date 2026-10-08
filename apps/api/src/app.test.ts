/**
 * Unit tests for the assembled app that don't need a running database.
 */
import { HealthResponseSchema } from '@agent-dashboard/shared';
import request from 'supertest';
import type { ErrorResponseBody } from './middleware/error-handler.js';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createDataAccess } from './db/data-access.js';
import { buildKnexConnectionConfig, createDatabaseClient } from './db/knex.js';
import { createLogger } from './logger.js';
import { createRunEventBus } from './modules/runs/run-event-bus.js';
import { createRunManager } from './modules/runs/run-manager.js';
import { createFakeSandboxProvider } from '../test/fake-sandbox-provider.js';

/** Nothing listens on port 1, so every connection attempt is refused at once. */
const UNREACHABLE_DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:1/none';

const unreachableDatabase = createDatabaseClient(
  buildKnexConnectionConfig(UNREACHABLE_DATABASE_URL),
);
const logger = createLogger('silent');
const app = createApp({
  database: unreachableDatabase,
  logger,
  runManager: createRunManager({
    dataAccess: createDataAccess(unreachableDatabase),
    sandboxProvider: createFakeSandboxProvider(),
    eventBus: createRunEventBus(),
    logger,
    runDataDirectory: '/nonexistent/runs',
  }),
  settings: {
    appOrigins: ['http://dashboard.test'],
    trustProxyHops: 0,
    isSecureCookie: false,
    skillStorageDirectory: '/nonexistent/skills',
    runs: { maxConcurrentRuns: 1, providerApiKeys: {} },
  },
});

afterAll(async () => {
  await unreachableDatabase.destroy();
});

describe('createApp', () => {
  it('reports 503 and a degraded status when the database is unreachable', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(503);
    expect(HealthResponseSchema.parse(response.body)).toMatchObject({
      status: 'degraded',
      checks: { database: 'down' },
    });
  });

  it('sets security headers through helmet', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('returns JSON 404s for unknown routes outside the API', async () => {
    const response = await request(app).get('/nope');

    expect(response.status).toBe(404);
    expect((response.body as ErrorResponseBody).error.code).toBe('not_found');
  });
});
