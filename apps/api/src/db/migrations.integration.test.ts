/**
 * Integration tests for the migration set as a whole: it applies cleanly,
 * rolls back completely, and keeps CHECK constraints in sync with the
 * shared value lists.
 */
import { RUN_STATUSES, USER_ROLES } from '@agent-dashboard/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabaseClients, resetTestDatabase } from '../../test/database-test-helpers.js';

const EXPECTED_TABLES = [
  'agent_providers',
  'agent_run_skill_versions',
  'agent_runs',
  'agent_skill_assignments',
  'agents',
  'audit_log',
  'run_events',
  'sandbox_profiles',
  'skill_supported_providers',
  'skill_versions',
  'skills',
  'users',
];

const KNEX_BOOKKEEPING_TABLES = ['knex_migrations', 'knex_migrations_lock'];

const { ownerDatabase, appDatabase } = createTestDatabaseClients();

async function listApplicationTables(): Promise<string[]> {
  const rows = await ownerDatabase('pg_tables')
    .where({ schemaname: 'public' })
    .whereNotIn('tablename', KNEX_BOOKKEEPING_TABLES)
    .orderBy('tablename')
    .pluck<string[]>('tablename');
  return rows;
}

/** Returns the definition of a named CHECK constraint, e.g. `CHECK (status = ANY (...))`. */
async function getCheckConstraintDefinition(constraintName: string): Promise<string> {
  const result = await ownerDatabase.raw<{ rows: { definition: string }[] }>(
    'SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = ?',
    [constraintName],
  );
  const [row] = result.rows;
  if (!row) {
    throw new Error(`Constraint ${constraintName} not found`);
  }
  return row.definition;
}

/** Extracts the quoted string literals from a constraint definition. */
function extractQuotedValues(constraintDefinition: string): string[] {
  return [...constraintDefinition.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
}

beforeAll(async () => {
  await resetTestDatabase(ownerDatabase);
});

afterAll(async () => {
  await Promise.all([ownerDatabase.destroy(), appDatabase.destroy()]);
});

describe('migrations', () => {
  it('create every expected table', async () => {
    expect(await listApplicationTables()).toEqual(EXPECTED_TABLES);
  });

  it('roll back completely and re-apply cleanly', async () => {
    await ownerDatabase.migrate.rollback(undefined, true);
    expect(await listApplicationTables()).toEqual([]);

    await ownerDatabase.migrate.latest();
    expect(await listApplicationTables()).toEqual(EXPECTED_TABLES);
  });

  it('make every application table owned by the owner role', async () => {
    const tableOwners = await ownerDatabase('pg_tables')
      .where({ schemaname: 'public' })
      .distinct()
      .pluck<string[]>('tableowner');

    expect(tableOwners).toEqual(['agent_dashboard_owner']);
  });
});

describe('CHECK constraints match the shared value lists', () => {
  it('allows exactly the shared run statuses', async () => {
    const definition = await getCheckConstraintDefinition('agent_runs_status_check');

    expect(extractQuotedValues(definition)).toEqual([...RUN_STATUSES]);
  });

  it('allows exactly the shared user roles', async () => {
    const definition = await getCheckConstraintDefinition('users_role_check');

    expect(extractQuotedValues(definition)).toEqual([...USER_ROLES]);
  });
});
