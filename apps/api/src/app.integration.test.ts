/**
 * Integration test for the assembled app against the real test database,
 * connected as the restricted app role exactly as in production.
 */
import { HealthResponseSchema } from '@agent-dashboard/shared';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDatabaseClients } from '../test/database-test-helpers.js';
import { createTestApp } from '../test/test-app.js';

const { ownerDatabase, appDatabase } = createTestDatabaseClients();
const app = createTestApp(appDatabase);

afterAll(async () => {
  await Promise.all([ownerDatabase.destroy(), appDatabase.destroy()]);
});

describe('GET /api/health', () => {
  it('reports ok with the database up', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(HealthResponseSchema.parse(response.body)).toMatchObject({
      status: 'ok',
      checks: { database: 'up' },
    });
  });
});
