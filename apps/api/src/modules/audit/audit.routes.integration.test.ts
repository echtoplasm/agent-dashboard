/**
 * Integration tests for reading the audit log.
 */
import { AuditLogPageSchema } from '@agent-dashboard/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabaseClients,
  resetTestDatabase,
} from '../../../test/database-test-helpers.js';
import { createSignedInUser, createTestApp } from '../../../test/test-app.js';

const { ownerDatabase, appDatabase } = createTestDatabaseClients();
const app = createTestApp(appDatabase);

beforeAll(async () => {
  await resetTestDatabase(ownerDatabase);
});

afterAll(async () => {
  await Promise.all([ownerDatabase.destroy(), appDatabase.destroy()]);
});

describe('GET /api/audit-log', () => {
  it('is not available to viewers', async () => {
    const { agent } = await createSignedInUser(app, appDatabase, 'viewer');

    expect((await agent.get('/api/audit-log')).status).toBe(403);
  });

  it('returns newest entries first with the actor username', async () => {
    const { user, agent } = await createSignedInUser(app, appDatabase, 'operator');

    const response = await agent.get('/api/audit-log');

    expect(response.status).toBe(200);
    const page = AuditLogPageSchema.parse(response.body);
    expect(page.items[0]).toMatchObject({
      action: 'auth.login_succeeded',
      actorUserId: user.id,
      actorUsername: user.username,
    });
  });

  it('pages backwards with nextCursor until the log runs out', async () => {
    const { agent } = await createSignedInUser(app, appDatabase, 'operator');
    const seenIds: number[] = [];

    let cursor: number | null | undefined;
    do {
      const query = cursor === undefined ? '?limit=2' : `?limit=2&before=${cursor}`;
      const page = AuditLogPageSchema.parse((await agent.get(`/api/audit-log${query}`)).body);
      seenIds.push(...page.items.map((entry) => entry.id));
      cursor = page.nextCursor;
    } while (cursor !== null);

    const [totalEntries] = await appDatabase('audit_log').count<{ count: number }[]>({
      count: '*',
    });
    expect(seenIds).toHaveLength(totalEntries?.count ?? -1);
    expect([...seenIds].sort((left, right) => right - left)).toEqual(seenIds);
  });

  it('filters by target', async () => {
    const { user, agent } = await createSignedInUser(app, appDatabase, 'admin');

    const page = AuditLogPageSchema.parse(
      (await agent.get(`/api/audit-log?targetType=user&targetId=${user.id}`)).body,
    );

    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((entry) => entry.targetId === user.id)).toBe(true);
  });

  it('rejects an invalid limit', async () => {
    const { agent } = await createSignedInUser(app, appDatabase, 'admin');

    expect((await agent.get('/api/audit-log?limit=5000')).status).toBe(400);
  });
});
