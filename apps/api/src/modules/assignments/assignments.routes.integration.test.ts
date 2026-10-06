/**
 * Integration tests for assigning skills to agents, and for the checks that
 * stop later changes from breaking an existing loadout.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentSchema,
  AgentSkillAssignmentListResponseSchema,
  ProviderListResponseSchema,
  SandboxProfileSchema,
  SkillSchema,
  SkillVersionSummarySchema,
} from '@agent-dashboard/shared';
import type { Agent, SandboxProfile, Skill, SkillVersionSummary } from '@agent-dashboard/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabaseClients,
  resetTestDatabase,
} from '../../../test/database-test-helpers.js';
import { TEST_APP_ORIGIN, createSignedInUser, createTestApp } from '../../../test/test-app.js';
import type { SignedInAgent } from '../../../test/test-app.js';

const SKILL_MARKDOWN = '---\nname: x\ndescription: y\n---\nBody\n';
const NETWORK_MANIFEST = {
  manifestVersion: 1,
  network: { isAllowed: true, allowedHosts: ['registry.npmjs.org'] },
  commands: { allowedCommands: ['npm'] },
};

const { ownerDatabase, appDatabase } = createTestDatabaseClients();
const app = createTestApp(appDatabase, {
  skillStorageDirectory: await mkdtemp(join(tmpdir(), 'assignments-test-')),
});

let adminAgent: SignedInAgent;
let operatorAgent: SignedInAgent;
let claudeProviderId: string;
let codexProviderId: string;
let uniqueCounter = 0;

function nextName(prefix: string): string {
  uniqueCounter += 1;
  return `${prefix}-${uniqueCounter}`;
}

async function createProfile(overrides: Record<string, unknown> = {}): Promise<SandboxProfile> {
  const response = await adminAgent
    .post('/api/sandbox-profiles')
    .set('Origin', TEST_APP_ORIGIN)
    .send({
      name: nextName('profile'),
      containerImage: 'agent-dashboard/sandbox:latest',
      cpuLimitMillicores: 1000,
      memoryLimitMb: 1024,
      maxRunDurationSeconds: 600,
      ...overrides,
    });
  return SandboxProfileSchema.parse(response.body);
}

const NETWORKED_PROFILE = {
  isNetworkAllowed: true,
  allowedNetworkHosts: ['registry.npmjs.org'],
  allowedCommands: ['npm'],
};

async function createAgent(profileId: string, providerId = claudeProviderId): Promise<Agent> {
  const response = await operatorAgent
    .post('/api/agents')
    .set('Origin', TEST_APP_ORIGIN)
    .send({ name: nextName('agent'), providerId, sandboxProfileId: profileId });
  return AgentSchema.parse(response.body);
}

async function createSkillWithVersion(
  permissionsManifest: Record<string, unknown>,
  supportedProviderIds = [claudeProviderId],
): Promise<{ skill: Skill; version: SkillVersionSummary }> {
  const skill = SkillSchema.parse(
    (
      await operatorAgent
        .post('/api/skills')
        .set('Origin', TEST_APP_ORIGIN)
        .send({ slug: nextName('skill'), name: nextName('Skill'), supportedProviderIds })
    ).body,
  );
  const version = SkillVersionSummarySchema.parse(
    (
      await operatorAgent
        .post(`/api/skills/${skill.id}/versions`)
        .set('Origin', TEST_APP_ORIGIN)
        .send({
          version: '1.0.0',
          permissionsManifest,
          files: [{ path: 'SKILL.md', content: SKILL_MARKDOWN }],
        })
    ).body,
  );
  return { skill, version };
}

function assignSkill(agentId: string, skillId: string, skillVersionId: string) {
  return operatorAgent
    .put(`/api/agents/${agentId}/skills/${skillId}`)
    .set('Origin', TEST_APP_ORIGIN)
    .send({ skillVersionId });
}

beforeAll(async () => {
  await resetTestDatabase(ownerDatabase);
  await ownerDatabase.seed.run();
  adminAgent = (await createSignedInUser(app, appDatabase, 'admin')).agent;
  operatorAgent = (await createSignedInUser(app, appDatabase, 'operator')).agent;
  const providers = ProviderListResponseSchema.parse(
    (await operatorAgent.get('/api/providers')).body,
  ).items;
  claudeProviderId = providers.find((provider) => provider.slug === 'claude_code')?.id ?? '';
  codexProviderId = providers.find((provider) => provider.slug === 'codex')?.id ?? '';
});

afterAll(async () => {
  await Promise.all([ownerDatabase.destroy(), appDatabase.destroy()]);
});

describe('assigning skills', () => {
  it('assigns a fitting skill, lists it in the loadout, and audits it', async () => {
    const agent = await createAgent((await createProfile()).id);
    const { skill, version } = await createSkillWithVersion({ manifestVersion: 1 });

    const response = await assignSkill(agent.id, skill.id, version.id);
    const loadout = AgentSkillAssignmentListResponseSchema.parse(
      (await operatorAgent.get(`/api/agents/${agent.id}/skills`)).body,
    );

    expect(response.status).toBe(200);
    expect(loadout.items).toEqual([
      expect.objectContaining({ skillId: skill.id, skillVersionId: version.id, version: '1.0.0' }),
    ]);
    const auditEntry = await appDatabase('audit_log')
      .where({ target_id: agent.id, action: 'agent_skill.assigned' })
      .first<{ metadata: { version: string } } | undefined>('metadata');
    expect(auditEntry?.metadata.version).toBe('1.0.0');
  });

  it('refuses a skill whose manifest exceeds the sandbox profile, listing each violation', async () => {
    const agent = await createAgent((await createProfile()).id);
    const { skill, version } = await createSkillWithVersion(NETWORK_MANIFEST);

    const response = await assignSkill(agent.id, skill.id, version.id);

    expect(response.status).toBe(409);
    const body = response.body as { error: { fieldProblems: { path: string }[] } };
    expect(body.error.fieldProblems.map((problem) => problem.path)).toEqual([
      'network.isAllowed',
      'network.allowedHosts',
      'commands.allowedCommands',
    ]);
  });

  it('refuses a skill that does not support the agent provider', async () => {
    const agent = await createAgent((await createProfile()).id, codexProviderId);
    const { skill, version } = await createSkillWithVersion({ manifestVersion: 1 });

    const response = await assignSkill(agent.id, skill.id, version.id);

    expect(response.status).toBe(409);
  });

  it('refuses a version that belongs to a different skill', async () => {
    const agent = await createAgent((await createProfile()).id);
    const { skill } = await createSkillWithVersion({ manifestVersion: 1 });
    const { version: otherVersion } = await createSkillWithVersion({ manifestVersion: 1 });

    const response = await assignSkill(agent.id, skill.id, otherVersion.id);

    expect(response.status).toBe(400);
  });

  it('replaces the version when the same skill is assigned again, and unassigns', async () => {
    const agent = await createAgent((await createProfile()).id);
    const { skill, version } = await createSkillWithVersion({ manifestVersion: 1 });
    const secondVersion = SkillVersionSummarySchema.parse(
      (
        await operatorAgent
          .post(`/api/skills/${skill.id}/versions`)
          .set('Origin', TEST_APP_ORIGIN)
          .send({
            version: '1.1.0',
            permissionsManifest: { manifestVersion: 1 },
            files: [{ path: 'SKILL.md', content: SKILL_MARKDOWN }],
          })
      ).body,
    );
    await assignSkill(agent.id, skill.id, version.id);

    await assignSkill(agent.id, skill.id, secondVersion.id);
    const loadout = AgentSkillAssignmentListResponseSchema.parse(
      (await operatorAgent.get(`/api/agents/${agent.id}/skills`)).body,
    );
    expect(loadout.items.map((assignment) => assignment.version)).toEqual(['1.1.0']);

    const unassignResponse = await operatorAgent
      .delete(`/api/agents/${agent.id}/skills/${skill.id}`)
      .set('Origin', TEST_APP_ORIGIN);
    expect(unassignResponse.status).toBe(204);
    const emptyLoadout = AgentSkillAssignmentListResponseSchema.parse(
      (await operatorAgent.get(`/api/agents/${agent.id}/skills`)).body,
    );
    expect(emptyLoadout.items).toEqual([]);
  });
});

describe('protecting existing loadouts', () => {
  async function createAgentWithNetworkSkill() {
    const profile = await createProfile(NETWORKED_PROFILE);
    const agent = await createAgent(profile.id);
    const { skill, version } = await createSkillWithVersion(NETWORK_MANIFEST);
    const assignResponse = await assignSkill(agent.id, skill.id, version.id);
    expect(assignResponse.status).toBe(200);
    return { profile, agent, skill };
  }

  it('refuses to narrow a sandbox profile below an assigned skill', async () => {
    const { profile } = await createAgentWithNetworkSkill();

    const response = await adminAgent
      .patch(`/api/sandbox-profiles/${profile.id}`)
      .set('Origin', TEST_APP_ORIGIN)
      .send({ isNetworkAllowed: false, allowedNetworkHosts: [] });

    expect(response.status).toBe(409);
  });

  it('refuses to move an agent to a profile its skills do not fit', async () => {
    const { agent } = await createAgentWithNetworkSkill();
    const lockedProfile = await createProfile();

    const response = await operatorAgent
      .patch(`/api/agents/${agent.id}`)
      .set('Origin', TEST_APP_ORIGIN)
      .send({ sandboxProfileId: lockedProfile.id });

    expect(response.status).toBe(409);
  });

  it('refuses to switch an agent to a provider its skills do not support', async () => {
    const { agent } = await createAgentWithNetworkSkill();

    const response = await operatorAgent
      .patch(`/api/agents/${agent.id}`)
      .set('Origin', TEST_APP_ORIGIN)
      .send({ providerId: codexProviderId });

    expect(response.status).toBe(409);
  });

  it('refuses to drop a provider from a skill that agents on it use', async () => {
    const { skill } = await createAgentWithNetworkSkill();

    const response = await operatorAgent
      .patch(`/api/skills/${skill.id}`)
      .set('Origin', TEST_APP_ORIGIN)
      .send({ supportedProviderIds: [codexProviderId] });

    expect(response.status).toBe(409);
  });

  it('refuses to archive an assigned skill, but allows it once the agent is archived', async () => {
    const { agent, skill } = await createAgentWithNetworkSkill();

    const blockedResponse = await operatorAgent
      .post(`/api/skills/${skill.id}/archive`)
      .set('Origin', TEST_APP_ORIGIN);
    await operatorAgent.post(`/api/agents/${agent.id}/archive`).set('Origin', TEST_APP_ORIGIN);
    const allowedResponse = await operatorAgent
      .post(`/api/skills/${skill.id}/archive`)
      .set('Origin', TEST_APP_ORIGIN);

    expect(blockedResponse.status).toBe(409);
    expect(allowedResponse.status).toBe(200);
  });

  it('still allows widening a profile that agents use', async () => {
    const { profile } = await createAgentWithNetworkSkill();

    const response = await adminAgent
      .patch(`/api/sandbox-profiles/${profile.id}`)
      .set('Origin', TEST_APP_ORIGIN)
      .send({ allowedCommands: ['npm', 'git'] });

    expect(response.status).toBe(200);
  });
});
