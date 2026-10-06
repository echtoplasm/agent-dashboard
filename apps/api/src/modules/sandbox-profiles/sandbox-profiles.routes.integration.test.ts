/**
 * Integration tests for provider and sandbox profile routes.
 */
import {
  ProviderListResponseSchema,
  SandboxProfileListResponseSchema,
  SandboxProfileSchema,
} from '@agent-dashboard/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabaseClients,
  resetTestDatabase,
} from '../../../test/database-test-helpers.js';
import { TEST_APP_ORIGIN, createSignedInUser, createTestApp } from '../../../test/test-app.js';
import type { SignedInAgent } from '../../../test/test-app.js';

const { ownerDatabase, appDatabase } = createTestDatabaseClients();
const app = createTestApp(appDatabase);

let adminAgent: SignedInAgent;
let viewerAgent: SignedInAgent;

const VALID_PROFILE = {
  name: 'build-runner',
  containerImage: 'agent-dashboard/sandbox:latest',
  cpuLimitMillicores: 2000,
  memoryLimitMb: 2048,
  maxRunDurationSeconds: 1800,
};

beforeAll(async () => {
  await resetTestDatabase(ownerDatabase);
  await ownerDatabase.seed.run();
  adminAgent = (await createSignedInUser(app, appDatabase, 'admin')).agent;
  viewerAgent = (await createSignedInUser(app, appDatabase, 'viewer')).agent;
});

afterAll(async () => {
  await Promise.all([ownerDatabase.destroy(), appDatabase.destroy()]);
});

describe('providers', () => {
  it('lists the seeded providers to any signed-in user', async () => {
    const response = await viewerAgent.get('/api/providers');

    const { items } = ProviderListResponseSchema.parse(response.body);
    expect(items.map((provider) => provider.slug).sort()).toEqual(['claude_code', 'codex']);
  });

  it('lets only admins toggle a provider', async () => {
    const { items } = ProviderListResponseSchema.parse(
      (await adminAgent.get('/api/providers')).body,
    );
    const codex = items.find((provider) => provider.slug === 'codex');

    const viewerResponse = await viewerAgent
      .patch(`/api/providers/${codex?.id}`)
      .set('Origin', TEST_APP_ORIGIN)
      .send({ isEnabled: false });
    const adminResponse = await adminAgent
      .patch(`/api/providers/${codex?.id}`)
      .set('Origin', TEST_APP_ORIGIN)
      .send({ isEnabled: false });

    expect(viewerResponse.status).toBe(403);
    expect(adminResponse.status).toBe(200);
    expect(adminResponse.body).toMatchObject({ isEnabled: false });
  });
});

describe('sandbox profiles', () => {
  it('creates a profile with restrictive defaults and audits it', async () => {
    const response = await adminAgent
      .post('/api/sandbox-profiles')
      .set('Origin', TEST_APP_ORIGIN)
      .send(VALID_PROFILE);

    expect(response.status).toBe(201);
    const profile = SandboxProfileSchema.parse(response.body);
    expect(profile).toMatchObject({
      isNetworkAllowed: false,
      allowedNetworkHosts: [],
      writablePaths: [],
      allowedCommands: [],
    });
    const auditEntry = await appDatabase('audit_log')
      .where({ target_id: profile.id })
      .first<{ action: string } | undefined>('action');
    expect(auditEntry?.action).toBe('sandbox_profile.created');
  });

  it('stores permission lists as JSON arrays', async () => {
    const response = await adminAgent
      .post('/api/sandbox-profiles')
      .set('Origin', TEST_APP_ORIGIN)
      .send({
        ...VALID_PROFILE,
        name: 'networked',
        isNetworkAllowed: true,
        allowedNetworkHosts: ['registry.npmjs.org'],
        allowedCommands: ['npm', 'git'],
      });

    const profile = SandboxProfileSchema.parse(response.body);
    expect(profile.allowedNetworkHosts).toEqual(['registry.npmjs.org']);
    expect(profile.allowedCommands).toEqual(['npm', 'git']);
  });

  it('rejects allowed hosts without network access, including via a partial update', async () => {
    const createResponse = await adminAgent
      .post('/api/sandbox-profiles')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ ...VALID_PROFILE, name: 'inconsistent', allowedNetworkHosts: ['example.com'] });
    expect(createResponse.status).toBe(400);

    const created = SandboxProfileSchema.parse(
      (
        await adminAgent
          .post('/api/sandbox-profiles')
          .set('Origin', TEST_APP_ORIGIN)
          .send({ ...VALID_PROFILE, name: 'partial-update' })
      ).body,
    );
    const updateResponse = await adminAgent
      .patch(`/api/sandbox-profiles/${created.id}`)
      .set('Origin', TEST_APP_ORIGIN)
      .send({ allowedNetworkHosts: ['example.com'] });
    expect(updateResponse.status).toBe(400);
  });

  it('keeps untouched fields on a partial update', async () => {
    const created = SandboxProfileSchema.parse(
      (
        await adminAgent
          .post('/api/sandbox-profiles')
          .set('Origin', TEST_APP_ORIGIN)
          .send({ ...VALID_PROFILE, name: 'keeps-fields' })
      ).body,
    );

    const response = await adminAgent
      .patch(`/api/sandbox-profiles/${created.id}`)
      .set('Origin', TEST_APP_ORIGIN)
      .send({ memoryLimitMb: 4096 });

    expect(response.body).toMatchObject({ memoryLimitMb: 4096, cpuLimitMillicores: 2000 });
  });

  it('rejects a duplicate active name with 409', async () => {
    const response = await adminAgent
      .post('/api/sandbox-profiles')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ ...VALID_PROFILE, name: 'locked-down' });

    expect(response.status).toBe(409);
  });

  it('refuses to archive a profile used by an active agent', async () => {
    const [lockedDown] = await appDatabase('sandbox_profiles')
      .where({ name: 'locked-down' })
      .pluck<string[]>('id');
    const [provider] = await appDatabase('agent_providers').pluck<string[]>('id');
    await appDatabase('agents').insert({
      name: 'uses-locked-down',
      provider_id: provider,
      sandbox_profile_id: lockedDown,
    });

    const response = await adminAgent
      .post(`/api/sandbox-profiles/${lockedDown}/archive`)
      .set('Origin', TEST_APP_ORIGIN);

    expect(response.status).toBe(409);
  });

  it('archives an unused profile, hides it by default, and makes it read-only', async () => {
    const created = SandboxProfileSchema.parse(
      (
        await adminAgent
          .post('/api/sandbox-profiles')
          .set('Origin', TEST_APP_ORIGIN)
          .send({ ...VALID_PROFILE, name: 'to-archive' })
      ).body,
    );

    const archiveResponse = await adminAgent
      .post(`/api/sandbox-profiles/${created.id}/archive`)
      .set('Origin', TEST_APP_ORIGIN);
    const activeList = SandboxProfileListResponseSchema.parse(
      (await viewerAgent.get('/api/sandbox-profiles')).body,
    );
    const fullList = SandboxProfileListResponseSchema.parse(
      (await viewerAgent.get('/api/sandbox-profiles?includeArchived=true')).body,
    );
    const updateResponse = await adminAgent
      .patch(`/api/sandbox-profiles/${created.id}`)
      .set('Origin', TEST_APP_ORIGIN)
      .send({ memoryLimitMb: 512 });

    expect(archiveResponse.status).toBe(200);
    expect(activeList.items.some((profile) => profile.id === created.id)).toBe(false);
    expect(fullList.items.some((profile) => profile.id === created.id)).toBe(true);
    expect(updateResponse.status).toBe(409);
  });

  it('does not let viewers create profiles', async () => {
    const response = await viewerAgent
      .post('/api/sandbox-profiles')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ ...VALID_PROFILE, name: 'viewer-made' });

    expect(response.status).toBe(403);
  });
});
