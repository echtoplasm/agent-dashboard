/**
 * Helpers for integration tests that run against the Postgres test database.
 *
 * Tests connect twice: as the owner role (to migrate and set up fixtures) and
 * as the restricted app role (to check what the API can and cannot do).
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { buildMigrationKnexConfig } from '../knexfile.js';
import { createDatabaseClient, buildKnexConnectionConfig } from '../src/db/knex.js';

/** Owner and app connections to the test database. */
export interface TestDatabaseClients {
  ownerDatabase: Knex;
  appDatabase: Knex;
}

/** Thrown when the test database URLs are not configured. */
export class MissingTestDatabaseError extends Error {
  constructor(variableName: string) {
    super(
      `${variableName} is not set. Start Postgres with "docker compose up -d" and copy .env.example to .env.`,
    );
    this.name = 'MissingTestDatabaseError';
  }
}

function readRequiredVariable(variableName: string): string {
  const value = process.env[variableName];
  if (value === undefined || value === '') {
    throw new MissingTestDatabaseError(variableName);
  }
  return value;
}

/**
 * Connects to the test database as both roles.
 *
 * @returns Owner and app clients. Destroy both in `afterAll`.
 * @throws {MissingTestDatabaseError} If either test URL is missing.
 */
export function createTestDatabaseClients(): TestDatabaseClients {
  const ownerDatabase = createDatabaseClient(
    buildMigrationKnexConfig({
      nodeEnvironment: 'test',
      migrationDatabaseUrl: readRequiredVariable('TEST_MIGRATION_DATABASE_URL'),
    }),
  );
  const appDatabase = createDatabaseClient(
    buildKnexConnectionConfig(readRequiredVariable('TEST_DATABASE_URL')),
  );
  return { ownerDatabase, appDatabase };
}

/**
 * Rolls back every migration and re-applies them, leaving an empty, current
 * schema.
 *
 * @param ownerDatabase - A client connected as the owner role.
 */
export async function resetTestDatabase(ownerDatabase: Knex): Promise<void> {
  await ownerDatabase.migrate.rollback(undefined, true);
  await ownerDatabase.migrate.latest();
}

/** Ids of the minimal rows most tests need. */
export interface BaseFixtures {
  providerId: string;
  sandboxProfileId: string;
  agentId: string;
  skillId: string;
  skillVersionId: string;
}

const PLACEHOLDER_CONTENT_HASH = 'a'.repeat(64);

/**
 * Inserts one provider, sandbox profile, agent, skill and skill version, with
 * unique names so tests in the same file don't collide.
 *
 * @param ownerDatabase - A client connected as the owner role.
 * @returns The ids of the inserted rows.
 */
export async function insertBaseFixtures(ownerDatabase: Knex): Promise<BaseFixtures> {
  const uniqueSuffix = randomUUID().slice(0, 8);

  const [provider] = await ownerDatabase('agent_providers')
    .insert({
      slug: `test_provider_${uniqueSuffix}`,
      display_name: 'Test Provider',
      cli_command: 'test-cli',
    })
    .returning<{ id: string }[]>('id');
  const [sandboxProfile] = await ownerDatabase('sandbox_profiles')
    .insert({
      name: `test-profile-${uniqueSuffix}`,
      container_image: 'test-image:latest',
      cpu_limit_millicores: 1000,
      memory_limit_mb: 512,
      max_run_duration_seconds: 600,
    })
    .returning<{ id: string }[]>('id');
  const [agent] = await ownerDatabase('agents')
    .insert({
      name: `test-agent-${uniqueSuffix}`,
      provider_id: provider?.id,
      sandbox_profile_id: sandboxProfile?.id,
    })
    .returning<{ id: string }[]>('id');
  const [skill] = await ownerDatabase('skills')
    .insert({ slug: `test-skill-${uniqueSuffix}`, name: 'Test Skill' })
    .returning<{ id: string }[]>('id');
  const [skillVersion] = await ownerDatabase('skill_versions')
    .insert({
      skill_id: skill?.id,
      version: '1.0.0',
      content_hash: PLACEHOLDER_CONTENT_HASH,
      storage_path: `skills/test-skill-${uniqueSuffix}/1.0.0`,
      permissions_manifest: { manifestVersion: 1 },
    })
    .returning<{ id: string }[]>('id');

  if (!provider || !sandboxProfile || !agent || !skill || !skillVersion) {
    throw new Error('Failed to insert base fixtures');
  }
  return {
    providerId: provider.id,
    sandboxProfileId: sandboxProfile.id,
    agentId: agent.id,
    skillId: skill.id,
    skillVersionId: skillVersion.id,
  };
}
