/**
 * Integration tests for the seed files: they produce the expected rows and
 * can be re-run without errors or duplicates.
 */
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMigrationKnexConfig } from '../../knexfile.js';
import { createDatabaseClient } from './knex.js';
import { MissingTestDatabaseError, resetTestDatabase } from '../../test/database-test-helpers.js';

const TEST_MIGRATION_DATABASE_URL = process.env.TEST_MIGRATION_DATABASE_URL;
if (TEST_MIGRATION_DATABASE_URL === undefined) {
  throw new MissingTestDatabaseError('TEST_MIGRATION_DATABASE_URL');
}

/** Seeds as development so the sample-data seeds run too. */
const developmentSeedDatabase = createDatabaseClient(
  buildMigrationKnexConfig({
    nodeEnvironment: 'development',
    migrationDatabaseUrl: TEST_MIGRATION_DATABASE_URL,
  }),
);

async function countRows(database: Knex, tableName: string): Promise<number> {
  const result = await database(tableName).count<{ count: number }[]>({ count: '*' });
  return result[0]?.count ?? 0;
}

beforeAll(async () => {
  await resetTestDatabase(developmentSeedDatabase);
});

afterAll(async () => {
  await developmentSeedDatabase.destroy();
});

describe('seeds', () => {
  it('create both providers, the default profile and the sample agent', async () => {
    await developmentSeedDatabase.seed.run();

    const providerSlugs = await developmentSeedDatabase('agent_providers')
      .orderBy('slug')
      .pluck<string[]>('slug');
    expect(providerSlugs).toEqual(['claude_code', 'codex']);
    expect(await countRows(developmentSeedDatabase, 'sandbox_profiles')).toBe(1);
    expect(await countRows(developmentSeedDatabase, 'agent_skill_assignments')).toBe(1);
  });

  it('can be re-run without creating duplicates', async () => {
    const tablesToCheck = ['agent_providers', 'sandbox_profiles', 'agents', 'skill_versions'];
    const countsBefore = await Promise.all(
      tablesToCheck.map((tableName) => countRows(developmentSeedDatabase, tableName)),
    );

    await developmentSeedDatabase.seed.run();

    const countsAfter = await Promise.all(
      tablesToCheck.map((tableName) => countRows(developmentSeedDatabase, tableName)),
    );
    expect(countsAfter).toEqual(countsBefore);
  });
});
