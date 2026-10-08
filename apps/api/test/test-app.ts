/**
 * Helpers for route tests: build the app against a database, create users,
 * and get a signed-in Supertest agent.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import type { Knex } from 'knex';
import request from 'supertest';
import type { User, UserRole } from '@agent-dashboard/shared';
import { createApp } from '../src/app.js';
import type { AppSettings } from '../src/app.js';
import { createDataAccess } from '../src/db/data-access.js';
import { createLogger } from '../src/logger.js';
import { SYSTEM_AUDIT_CONTEXT } from '../src/modules/audit/audit.types.js';
import { createRunEventBus } from '../src/modules/runs/run-event-bus.js';
import { createRunManager } from '../src/modules/runs/run-manager.js';
import type { RunManager } from '../src/modules/runs/run-manager.js';
import { createUsersService } from '../src/modules/users/users.service.js';
import { createFakeSandboxProvider } from './fake-sandbox-provider.js';
import type { FakeSandboxProvider } from './fake-sandbox-provider.js';

/** The browser origin test requests claim to come from. */
export const TEST_APP_ORIGIN = 'http://dashboard.test';

/** Password given to every user created by `createTestUser`. */
export const TEST_USER_PASSWORD = 'test-password-long-enough';

/**
 * A throwaway skill storage directory per test file. It is left under the
 * OS temp directory: published files are read-only, so deleting them needs
 * the storage module's own removal routine.
 */
const TEST_SKILL_STORAGE_DIRECTORY = mkdtempSync(join(tmpdir(), 'agent-dashboard-skills-'));

/** A throwaway run data directory per test file. */
const TEST_RUN_DATA_DIRECTORY = mkdtempSync(join(tmpdir(), 'agent-dashboard-runs-'));

/** Fake keys long enough to be redacted. They are never sent anywhere. */
export const TEST_PROVIDER_API_KEYS = {
  ANTHROPIC_API_KEY: 'sk-ant-test-0000000000000000000000',
  OPENAI_API_KEY: 'sk-test-openai-000000000000000000',
};

/** Rate limits high enough that ordinary tests never hit them. */
const RELAXED_RATE_LIMITS = { apiRequestsPerMinute: 10_000, failedLoginsPerWindow: 10_000 };

/** The app plus the pieces run tests need to drive and observe runs. */
export interface TestAppWithRuns {
  app: Express;
  runManager: RunManager;
  sandboxProvider: FakeSandboxProvider;
  runDataDirectory: string;
}

/**
 * Builds the full app with test-friendly settings and a fake sandbox.
 *
 * @param database - Knex client connected as the app role.
 * @param overrides - Settings to change, e.g. strict rate limits.
 * @returns The app, its run manager and the fake sandbox provider.
 */
export function createTestAppWithRuns(
  database: Knex,
  overrides: Partial<AppSettings> = {},
): TestAppWithRuns {
  const logger = createLogger('silent');
  const sandboxProvider = createFakeSandboxProvider();
  const runManager = createRunManager({
    dataAccess: createDataAccess(database),
    sandboxProvider,
    eventBus: createRunEventBus(),
    logger,
    runDataDirectory: TEST_RUN_DATA_DIRECTORY,
  });
  const app = createApp({
    database,
    logger,
    runManager,
    settings: {
      appOrigins: [TEST_APP_ORIGIN],
      trustProxyHops: 0,
      isSecureCookie: false,
      skillStorageDirectory: TEST_SKILL_STORAGE_DIRECTORY,
      runs: { maxConcurrentRuns: 2, providerApiKeys: TEST_PROVIDER_API_KEYS },
      rateLimits: RELAXED_RATE_LIMITS,
      ...overrides,
    },
  });
  return { app, runManager, sandboxProvider, runDataDirectory: TEST_RUN_DATA_DIRECTORY };
}

/**
 * Builds the full app with test-friendly settings.
 *
 * @param database - Knex client connected as the app role.
 * @param overrides - Settings to change, e.g. strict rate limits.
 * @returns The Express app.
 */
export function createTestApp(database: Knex, overrides: Partial<AppSettings> = {}): Express {
  return createTestAppWithRuns(database, overrides).app;
}

/**
 * Creates a user with a unique username and `TEST_USER_PASSWORD`.
 *
 * @param database - Knex client connected as the app role.
 * @param role - The user's role.
 * @returns The created user.
 */
export function createTestUser(database: Knex, role: UserRole): Promise<User> {
  return createUsersService(createDataAccess(database)).createUser(
    {
      username: `${role}-${randomUUID().slice(0, 8)}`,
      role,
      password: TEST_USER_PASSWORD,
    },
    SYSTEM_AUDIT_CONTEXT,
  );
}

/** A Supertest agent that keeps cookies between requests. */
export type SignedInAgent = ReturnType<typeof request.agent>;

/**
 * Signs a user in and returns an agent carrying their session cookie.
 *
 * @param app - The app under test.
 * @param username - Username to sign in as.
 * @returns A cookie-keeping agent.
 * @throws {Error} If login does not succeed.
 */
export async function signIn(app: Express, username: string): Promise<SignedInAgent> {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/auth/login')
    .set('Origin', TEST_APP_ORIGIN)
    .send({ username, password: TEST_USER_PASSWORD });
  if (response.status !== 200) {
    throw new Error(`Test sign-in failed with ${response.status}: ${response.text}`);
  }
  return agent;
}

/**
 * Creates a user with the given role and signs them in.
 *
 * @param app - The app under test.
 * @param database - Knex client connected as the app role.
 * @param role - The user's role.
 * @returns The user and their signed-in agent.
 */
export async function createSignedInUser(
  app: Express,
  database: Knex,
  role: UserRole,
): Promise<{ user: User; agent: SignedInAgent }> {
  const user = await createTestUser(database, role);
  return { user, agent: await signIn(app, user.username) };
}
