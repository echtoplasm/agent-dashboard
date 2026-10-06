/**
 * Integration tests for the protections the schema enforces on its own:
 * role privileges, immutability triggers, partial unique indexes and
 * cross-table consistency constraints.
 *
 * These guard the security properties described in D-005 of
 * docs/decisions.md, so a migration that weakens them fails CI.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BaseFixtures } from '../../test/database-test-helpers.js';
import {
  createTestDatabaseClients,
  insertBaseFixtures,
  resetTestDatabase,
} from '../../test/database-test-helpers.js';

const PERMISSION_DENIED = /permission denied/;
const MUST_BE_OWNER = /must be owner/;
const ROWS_ARE_IMMUTABLE = /rows are immutable/;
const UNIQUE_VIOLATION = /duplicate key value violates unique constraint/;
const FOREIGN_KEY_VIOLATION = /violates foreign key constraint/;
const CHECK_VIOLATION = /violates check constraint/;

const { ownerDatabase, appDatabase } = createTestDatabaseClients();
let fixtures: BaseFixtures;

beforeAll(async () => {
  await resetTestDatabase(ownerDatabase);
});

beforeEach(async () => {
  fixtures = await insertBaseFixtures(ownerDatabase);
});

afterAll(async () => {
  await Promise.all([ownerDatabase.destroy(), appDatabase.destroy()]);
});

async function insertAuditEntry(): Promise<number> {
  const [entry] = await appDatabase('audit_log')
    .insert({ action: 'agent_run.launched', target_type: 'agent', target_id: fixtures.agentId })
    .returning<{ id: number }[]>('id');
  if (!entry) {
    throw new Error('Audit entry was not inserted');
  }
  return entry.id;
}

describe('audit_log', () => {
  it('lets the app role insert and read entries', async () => {
    const auditEntryId = await insertAuditEntry();

    const storedEntry = await appDatabase('audit_log')
      .where({ id: auditEntryId })
      .first<{ action: string }>('action');
    expect(storedEntry).toMatchObject({ action: 'agent_run.launched' });
  });

  it('returns ids as numbers thanks to the int8 parser', async () => {
    expect(typeof (await insertAuditEntry())).toBe('number');
  });

  it('denies the app role UPDATE, DELETE and TRUNCATE', async () => {
    const auditEntryId = await insertAuditEntry();

    await expect(
      appDatabase('audit_log').where({ id: auditEntryId }).update({ action: 'agent.edited' }),
    ).rejects.toThrow(PERMISSION_DENIED);
    await expect(appDatabase('audit_log').where({ id: auditEntryId }).delete()).rejects.toThrow(
      PERMISSION_DENIED,
    );
    await expect(appDatabase.raw('TRUNCATE audit_log')).rejects.toThrow(PERMISSION_DENIED);
  });

  it('prevents the app role from disabling the immutability trigger', async () => {
    await expect(
      appDatabase.raw('ALTER TABLE audit_log DISABLE TRIGGER audit_log_reject_row_modification'),
    ).rejects.toThrow(MUST_BE_OWNER);
  });

  it('rejects UPDATE, DELETE and TRUNCATE even from the owner role', async () => {
    const auditEntryId = await insertAuditEntry();

    await expect(
      ownerDatabase('audit_log').where({ id: auditEntryId }).update({ action: 'agent.edited' }),
    ).rejects.toThrow(ROWS_ARE_IMMUTABLE);
    await expect(ownerDatabase('audit_log').where({ id: auditEntryId }).delete()).rejects.toThrow(
      ROWS_ARE_IMMUTABLE,
    );
    await expect(ownerDatabase.raw('TRUNCATE audit_log')).rejects.toThrow(ROWS_ARE_IMMUTABLE);
  });

  it('rejects malformed action names', async () => {
    await expect(appDatabase('audit_log').insert({ action: 'Launched Run' })).rejects.toThrow(
      CHECK_VIOLATION,
    );
  });
});

describe('skill_versions', () => {
  it('rejects UPDATE even from the owner role', async () => {
    await expect(
      ownerDatabase('skill_versions')
        .where({ id: fixtures.skillVersionId })
        .update({ storage_path: 'tampered' }),
    ).rejects.toThrow(ROWS_ARE_IMMUTABLE);
  });

  it('denies the app role UPDATE and DELETE', async () => {
    await expect(
      appDatabase('skill_versions')
        .where({ id: fixtures.skillVersionId })
        .update({ storage_path: 'tampered' }),
    ).rejects.toThrow(PERMISSION_DENIED);
    await expect(
      appDatabase('skill_versions').where({ id: fixtures.skillVersionId }).delete(),
    ).rejects.toThrow(PERMISSION_DENIED);
  });

  it('rejects a duplicate version string for the same skill', async () => {
    await expect(
      appDatabase('skill_versions').insert({
        skill_id: fixtures.skillId,
        version: '1.0.0',
        content_hash: 'b'.repeat(64),
        storage_path: 'skills/duplicate',
        permissions_manifest: { manifestVersion: 1 },
      }),
    ).rejects.toThrow(UNIQUE_VIOLATION);
  });

  it.each(['v1.0.0', '1.0', '01.0.0'])('rejects non-semver version %j', async (version) => {
    await expect(
      appDatabase('skill_versions').insert({
        skill_id: fixtures.skillId,
        version,
        content_hash: 'c'.repeat(64),
        storage_path: 'skills/bad-version',
        permissions_manifest: { manifestVersion: 1 },
      }),
    ).rejects.toThrow(CHECK_VIOLATION);
  });
});

describe('agent_skill_assignments', () => {
  it('rejects a skill version that belongs to a different skill', async () => {
    const otherFixtures = await insertBaseFixtures(ownerDatabase);

    await expect(
      appDatabase('agent_skill_assignments').insert({
        agent_id: fixtures.agentId,
        skill_id: fixtures.skillId,
        skill_version_id: otherFixtures.skillVersionId,
      }),
    ).rejects.toThrow(FOREIGN_KEY_VIOLATION);
  });

  it('allows only one version of each skill per agent', async () => {
    const [secondVersion] = await ownerDatabase('skill_versions')
      .insert({
        skill_id: fixtures.skillId,
        version: '1.1.0',
        content_hash: 'd'.repeat(64),
        storage_path: 'skills/test/1.1.0',
        permissions_manifest: { manifestVersion: 1 },
      })
      .returning<{ id: string }[]>('id');
    await appDatabase('agent_skill_assignments').insert({
      agent_id: fixtures.agentId,
      skill_id: fixtures.skillId,
      skill_version_id: fixtures.skillVersionId,
    });

    await expect(
      appDatabase('agent_skill_assignments').insert({
        agent_id: fixtures.agentId,
        skill_id: fixtures.skillId,
        skill_version_id: secondVersion?.id,
      }),
    ).rejects.toThrow(UNIQUE_VIOLATION);
  });
});

describe('archivable tables', () => {
  it('allow reusing an agent name once the original is archived', async () => {
    const { name: agentName } = await ownerDatabase('agents')
      .where({ id: fixtures.agentId })
      .first<{ name: string }>('name');
    const duplicateAgent = {
      name: agentName,
      provider_id: fixtures.providerId,
      sandbox_profile_id: fixtures.sandboxProfileId,
    };

    await expect(appDatabase('agents').insert(duplicateAgent)).rejects.toThrow(UNIQUE_VIOLATION);

    await appDatabase('agents')
      .where({ id: fixtures.agentId })
      .update({ archived_at: appDatabase.fn.now() });
    await expect(appDatabase('agents').insert(duplicateAgent)).resolves.toBeDefined();
  });

  it('keep active skill slugs unique', async () => {
    const { slug } = await ownerDatabase('skills')
      .where({ id: fixtures.skillId })
      .first<{ slug: string }>('slug');

    await expect(appDatabase('skills').insert({ slug, name: 'Duplicate' })).rejects.toThrow(
      UNIQUE_VIOLATION,
    );
  });
});

describe('agent_runs and run_events', () => {
  async function insertRun(): Promise<string> {
    const [run] = await appDatabase('agent_runs')
      .insert({ agent_id: fixtures.agentId, provider_id: fixtures.providerId, prompt: 'hello' })
      .returning<{ id: string }[]>('id');
    if (!run) {
      throw new Error('Run was not inserted');
    }
    return run.id;
  }

  it('reject a negative token count but accept zero', async () => {
    const runId = await insertRun();

    await expect(
      appDatabase('agent_runs').where({ id: runId }).update({ output_tokens: 0 }),
    ).resolves.toBe(1);
    await expect(
      appDatabase('agent_runs').where({ id: runId }).update({ output_tokens: -1 }),
    ).rejects.toThrow(CHECK_VIOLATION);
  });

  it('reject an unknown run status', async () => {
    const runId = await insertRun();

    await expect(
      appDatabase('agent_runs').where({ id: runId }).update({ status: 'exploded' }),
    ).rejects.toThrow(CHECK_VIOLATION);
  });

  it('keep run events immutable', async () => {
    const runId = await insertRun();
    await appDatabase('run_events').insert({
      run_id: runId,
      sequence_number: 0,
      event_type: 'assistant_message',
      payload: { text: 'hi' },
    });

    await expect(
      appDatabase('run_events').where({ run_id: runId }).update({ payload: {} }),
    ).rejects.toThrow(PERMISSION_DENIED);
    await expect(
      ownerDatabase('run_events').where({ run_id: runId }).update({ payload: {} }),
    ).rejects.toThrow(ROWS_ARE_IMMUTABLE);
  });

  it('reject a duplicate event sequence number within a run', async () => {
    const runId = await insertRun();
    const event = { run_id: runId, sequence_number: 0, event_type: 'started', payload: {} };
    await appDatabase('run_events').insert(event);

    await expect(appDatabase('run_events').insert(event)).rejects.toThrow(UNIQUE_VIOLATION);
  });
});

describe('app role schema privileges', () => {
  it('cannot create tables', async () => {
    await expect(appDatabase.raw('CREATE TABLE intruder (id int)')).rejects.toThrow(
      PERMISSION_DENIED,
    );
  });

  it('cannot read or alter the migration bookkeeping tables', async () => {
    await expect(appDatabase('knex_migrations').select()).rejects.toThrow(PERMISSION_DENIED);
  });
});
