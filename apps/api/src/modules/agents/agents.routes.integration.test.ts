/**
 * Integration tests for agent routes.
 */
import {
  AgentListResponseSchema,
  AgentSchema,
  ProviderListResponseSchema,
  SandboxProfileListResponseSchema,
} from '@agent-dashboard/shared';
import type { Agent } from '@agent-dashboard/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabaseClients,
  resetTestDatabase,
} from '../../../test/database-test-helpers.js';
import { TEST_APP_ORIGIN, createSignedInUser, createTestApp } from '../../../test/test-app.js';
import type { SignedInAgent } from '../../../test/test-app.js';

const { ownerDatabase, appDatabase } = createTestDatabaseClients();
const app = createTestApp(appDatabase);

let operatorAgent: SignedInAgent;
let viewerAgent: SignedInAgent;
let claudeProviderId: string;
let codexProviderId: string;
let lockedDownProfileId: string;

async function createAgent(body: Record<string, unknown>): Promise<Agent> {
  const response = await operatorAgent
    .post('/api/agents')
    .set('Origin', TEST_APP_ORIGIN)
    .send({ providerId: claudeProviderId, sandboxProfileId: lockedDownProfileId, ...body });
  if (response.status !== 201) {
    throw new Error(`Creating agent failed: ${response.status} ${response.text}`);
  }
  return AgentSchema.parse(response.body);
}

beforeAll(async () => {
  await resetTestDatabase(ownerDatabase);
  await ownerDatabase.seed.run();
  operatorAgent = (await createSignedInUser(app, appDatabase, 'operator')).agent;
  viewerAgent = (await createSignedInUser(app, appDatabase, 'viewer')).agent;

  const providers = ProviderListResponseSchema.parse(
    (await operatorAgent.get('/api/providers')).body,
  ).items;
  claudeProviderId = providers.find((provider) => provider.slug === 'claude_code')?.id ?? '';
  codexProviderId = providers.find((provider) => provider.slug === 'codex')?.id ?? '';
  const profiles = SandboxProfileListResponseSchema.parse(
    (await operatorAgent.get('/api/sandbox-profiles')).body,
  ).items;
  lockedDownProfileId = profiles[0]?.id ?? '';
});

afterAll(async () => {
  await Promise.all([ownerDatabase.destroy(), appDatabase.destroy()]);
});

describe('creating agents', () => {
  it('records who created the agent and applies defaults', async () => {
    const agent = await createAgent({ name: 'docs-writer' });

    expect(agent).toMatchObject({
      name: 'docs-writer',
      description: '',
      model: null,
      maxCostPerRunMicroUsd: null,
      archivedAt: null,
    });
    expect(agent.createdBy).not.toBeNull();
  });

  it('rejects names that are not kebab-case', async () => {
    const response = await operatorAgent.post('/api/agents').set('Origin', TEST_APP_ORIGIN).send({
      name: 'Docs Writer',
      providerId: claudeProviderId,
      sandboxProfileId: lockedDownProfileId,
    });

    expect(response.status).toBe(400);
  });

  it('rejects extra CLI arguments, which are not accepted until the adapters exist', async () => {
    const response = await operatorAgent
      .post('/api/agents')
      .set('Origin', TEST_APP_ORIGIN)
      .send({
        name: 'sneaky',
        providerId: claudeProviderId,
        sandboxProfileId: lockedDownProfileId,
        extraArgs: ['--dangerously-skip-permissions'],
      });

    expect(response.status).toBe(400);
  });

  it('rejects an unknown provider with a field problem', async () => {
    const response = await operatorAgent.post('/api/agents').set('Origin', TEST_APP_ORIGIN).send({
      name: 'orphan',
      providerId: '00000000-0000-7000-8000-000000000000',
      sandboxProfileId: lockedDownProfileId,
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { fieldProblems: [{ path: 'providerId' }] } });
  });

  it('refuses a disabled provider', async () => {
    await appDatabase('agent_providers')
      .where({ id: codexProviderId })
      .update({ is_enabled: false });

    const response = await operatorAgent.post('/api/agents').set('Origin', TEST_APP_ORIGIN).send({
      name: 'codex-agent',
      providerId: codexProviderId,
      sandboxProfileId: lockedDownProfileId,
    });

    expect(response.status).toBe(409);
    await appDatabase('agent_providers')
      .where({ id: codexProviderId })
      .update({ is_enabled: true });
  });

  it('does not let viewers create agents', async () => {
    const response = await viewerAgent.post('/api/agents').set('Origin', TEST_APP_ORIGIN).send({
      name: 'viewer-agent',
      providerId: claudeProviderId,
      sandboxProfileId: lockedDownProfileId,
    });

    expect(response.status).toBe(403);
  });
});

describe('updating and archiving agents', () => {
  it('applies a partial update and can clear the model with null', async () => {
    const agent = await createAgent({ name: 'partial', model: 'claude-opus-5-5' });

    const response = await operatorAgent
      .patch(`/api/agents/${agent.id}`)
      .set('Origin', TEST_APP_ORIGIN)
      .send({ model: null, maxCostPerRunMicroUsd: 2_500_000 });

    expect(response.body).toMatchObject({
      name: 'partial',
      model: null,
      maxCostPerRunMicroUsd: 2_500_000,
    });
  });

  it('still allows edits after its provider is disabled, as long as the provider is unchanged', async () => {
    const agent = await createAgent({ name: 'kept-provider' });
    await appDatabase('agent_providers')
      .where({ id: claudeProviderId })
      .update({ is_enabled: false });

    const response = await operatorAgent
      .patch(`/api/agents/${agent.id}`)
      .set('Origin', TEST_APP_ORIGIN)
      .send({ description: 'still editable' });

    await appDatabase('agent_providers')
      .where({ id: claudeProviderId })
      .update({ is_enabled: true });
    expect(response.status).toBe(200);
  });

  it('archives an agent, hides it from the default list, and frees its name', async () => {
    const agent = await createAgent({ name: 'short-lived' });

    const archiveResponse = await operatorAgent
      .post(`/api/agents/${agent.id}/archive`)
      .set('Origin', TEST_APP_ORIGIN);
    const editResponse = await operatorAgent
      .patch(`/api/agents/${agent.id}`)
      .set('Origin', TEST_APP_ORIGIN)
      .send({ description: 'too late' });
    const activeAgents = AgentListResponseSchema.parse((await viewerAgent.get('/api/agents')).body);
    const replacement = await createAgent({ name: 'short-lived' });

    expect(archiveResponse.status).toBe(200);
    expect(editResponse.status).toBe(409);
    expect(activeAgents.items.some((listed) => listed.id === agent.id)).toBe(false);
    expect(replacement.id).not.toBe(agent.id);
  });

  it('returns 404 for an unknown agent', async () => {
    const response = await viewerAgent.get('/api/agents/00000000-0000-7000-8000-000000000000');

    expect(response.status).toBe(404);
  });
});
