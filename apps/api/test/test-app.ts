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
import { createUsersService } from '../src/modules/users/users.service.js';

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

/** Rate limits high enough that ordinary tests never hit them. */
const RELAXED_RATE_LIMITS = { apiRequestsPerMinute: 10_000, failedLoginsPerWindow: 10_000 };

/**
 * Builds the full app with test-friendly settings.
 *
 * @param database - Knex client connected as the app role.
 * @param overrides - Settings to change, e.g. strict rate limits.
 * @returns The Express app.
 */
export function createTestApp(database: Knex, overrides: Partial<AppSettings> = {}): Express {
  return createApp({
    database,
    logger: createLogger('silent'),
    settings: {
      appOrigins: [TEST_APP_ORIGIN],
      trustProxyHops: 0,
      isSecureCookie: false,
      skillStorageDirectory: TEST_SKILL_STORAGE_DIRECTORY,
      rateLimits: RELAXED_RATE_LIMITS,
      ...overrides,
    },
  });
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
