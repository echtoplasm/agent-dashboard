/**
 * Integration tests for launching, executing, streaming and cancelling runs.
 *
 * The sandbox is a scripted fake, so these tests cover everything except
 * Docker itself: launch rules, the audit trail, event storage, usage and
 * cost, redaction, SSE replay, cancellation, capacity and recovery.
 */
import { readFileSync } from 'node:fs';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AgentSchema,
  AgentUsageSchema,
  AuditLogPageSchema,
  ProviderListResponseSchema,
  RunDetailSchema,
  RunEventPageSchema,
  RunListPageSchema,
  SandboxProfileListResponseSchema,
  SkillSchema,
  WorkspaceListingSchema,
} from '@agent-dashboard/shared';
import type { Agent, RunDetail, RunEvent } from '@agent-dashboard/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabaseClients,
  resetTestDatabase,
} from '../../../test/database-test-helpers.js';
import type { FakeSandboxScript } from '../../../test/fake-sandbox-provider.js';
import {
  TEST_APP_ORIGIN,
  TEST_PROVIDER_API_KEYS,
  createSignedInUser,
  createTestAppWithRuns,
  signIn,
} from '../../../test/test-app.js';
import type { SignedInAgent } from '../../../test/test-app.js';
import { INTERRUPTED_RUN_MESSAGE } from './run-manager.js';

const { ownerDatabase, appDatabase } = createTestDatabaseClients();
const { app, runManager, sandboxProvider, runDataDirectory } = createTestAppWithRuns(appDatabase);

const FIXTURES_DIRECTORY = new URL('../../adapters/fixtures/', import.meta.url);
const POLL_INTERVAL_MS = 10;
const POLL_TIMEOUT_MS = 3_000;

let operatorAgent: SignedInAgent;
let viewerAgent: SignedInAgent;
let adminAgent: SignedInAgent;
let claudeProviderId = '';
let codexProviderId = '';
let lockedDownProfileId = '';

function readFixtureLines(fixtureName: string): string[] {
  return readFileSync(new URL(fixtureName, FIXTURES_DIRECTORY), 'utf8')
    .split('\n')
    .filter((line) => line !== '');
}

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

async function launchRun(
  agentId: string,
  script?: FakeSandboxScript,
  prompt = 'Fix the failing test',
): Promise<RunDetail> {
  if (script !== undefined) {
    sandboxProvider.enqueueScript(script);
  }
  const response = await operatorAgent
    .post('/api/runs')
    .set('Origin', TEST_APP_ORIGIN)
    .send({ agentId, prompt });
  if (response.status !== 201) {
    throw new Error(`Launching failed: ${response.status} ${response.text}`);
  }
  return RunDetailSchema.parse(response.body);
}

async function getRun(runId: string): Promise<RunDetail> {
  return RunDetailSchema.parse((await viewerAgent.get(`/api/runs/${runId}`)).body);
}

async function launchAndFinish(agentId: string, script?: FakeSandboxScript): Promise<RunDetail> {
  const run = await launchRun(agentId, script);
  await runManager.waitForRun(run.id);
  return getRun(run.id);
}

async function listEvents(runId: string): Promise<RunEvent[]> {
  const response = await viewerAgent.get(`/api/runs/${runId}/events`);
  return RunEventPageSchema.parse(response.body).items;
}

async function waitForStatus(runId: string, status: RunDetail['status']): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while ((await getRun(runId)).status !== status) {
    if (Date.now() > deadline) {
      throw new Error(`Run ${runId} never reached ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

const WAIT_FOR_STOP_SCRIPT: FakeSandboxScript = {
  stdoutLines: [JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' })],
  exitCode: 0,
  shouldWaitForStop: true,
};

beforeAll(async () => {
  await resetTestDatabase(ownerDatabase);
  await ownerDatabase.seed.run();
  operatorAgent = (await createSignedInUser(app, appDatabase, 'operator')).agent;
  viewerAgent = (await createSignedInUser(app, appDatabase, 'viewer')).agent;
  adminAgent = (await createSignedInUser(app, appDatabase, 'admin')).agent;
  const providers = ProviderListResponseSchema.parse(
    (await viewerAgent.get('/api/providers')).body,
  ).items;
  claudeProviderId = providers.find((provider) => provider.slug === 'claude_code')?.id ?? '';
  codexProviderId = providers.find((provider) => provider.slug === 'codex')?.id ?? '';
  const profiles = SandboxProfileListResponseSchema.parse(
    (await viewerAgent.get('/api/sandbox-profiles')).body,
  ).items;
  lockedDownProfileId = profiles[0]?.id ?? '';
});

afterAll(async () => {
  await Promise.all([ownerDatabase.destroy(), appDatabase.destroy()]);
});

describe('launching a run', () => {
  it('runs to success, recording usage, provider cost, events and an audit entry', async () => {
    const agent = await createAgent({ name: 'happy-path' });
    const finishedRun = await launchAndFinish(agent.id);
    const events = await listEvents(finishedRun.id);
    const auditPage = AuditLogPageSchema.parse(
      (await operatorAgent.get(`/api/audit-log?targetType=run&targetId=${finishedRun.id}`)).body,
    );

    expect(finishedRun).toMatchObject({
      status: 'succeeded',
      exitCode: 0,
      errorMessage: null,
      model: 'claude-opus-5-5',
      providerSessionId: 'session-1',
      sandboxId: `fake-${finishedRun.id}`,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 1_000,
      cacheWriteTokens: 50,
      costMicroUsd: 12_500,
      costSource: 'provider_reported',
      agentName: 'happy-path',
      providerSlug: 'claude_code',
    });
    expect(finishedRun.startedAt).not.toBeNull();
    expect(finishedRun.endedAt).not.toBeNull();
    expect(events.map((event) => event.type)).toEqual([
      'run.status',
      'run.status',
      'session.started',
      'assistant.text',
      'usage',
      'run.result',
      'run.status',
    ]);
    expect(events.map((event) => event.sequenceNumber)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(events.at(-1)).toMatchObject({ payload: { status: 'succeeded' } });
    expect(auditPage.items).toEqual([
      expect.objectContaining({
        action: 'run.launched',
        metadata: expect.objectContaining({ agentName: 'happy-path', promptLength: 20 }) as unknown,
      }),
    ]);
  });

  it('sends the prompt on stdin and the API key only as a secret variable', async () => {
    const agent = await createAgent({ name: 'invocation-check', model: 'claude-opus-5-5' });
    const run = await launchAndFinish(agent.id);
    const spec = sandboxProvider.startedSpecs.find((startedSpec) => startedSpec.runId === run.id);

    expect(spec?.stdin).toBe('Fix the failing test');
    expect(spec?.secretEnvironment).toEqual({
      ANTHROPIC_API_KEY: TEST_PROVIDER_API_KEYS.ANTHROPIC_API_KEY,
    });
    expect(spec?.command).toContain('--model=claude-opus-5-5');
    expect(JSON.stringify(spec?.command)).not.toContain(TEST_PROVIDER_API_KEYS.ANTHROPIC_API_KEY);
    expect(spec?.containerImage).toBe('agent-dashboard/sandbox:latest');
  });

  it('pins and mounts the assigned skill versions', async () => {
    const skillResponse = await operatorAgent
      .post('/api/skills')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ slug: 'greeter', name: 'Greeter', supportedProviderIds: [claudeProviderId] });
    const skill = SkillSchema.parse(skillResponse.body);
    const versionResponse = await operatorAgent
      .post(`/api/skills/${skill.id}/versions`)
      .set('Origin', TEST_APP_ORIGIN)
      .send({
        version: '1.0.0',
        permissionsManifest: { manifestVersion: 1 },
        files: [{ path: 'SKILL.md', content: '---\nname: greeter\ndescription: Greets\n---\nHi' }],
      });
    expect(versionResponse.status).toBe(201);
    const versionId = (versionResponse.body as { id: string }).id;
    const agent = await createAgent({ name: 'skilled' });
    await operatorAgent
      .put(`/api/agents/${agent.id}/skills/${skill.id}`)
      .set('Origin', TEST_APP_ORIGIN)
      .send({ skillVersionId: versionId });

    const run = await launchAndFinish(agent.id);
    const spec = sandboxProvider.startedSpecs.find((startedSpec) => startedSpec.runId === run.id);

    expect(run.skillVersions).toEqual([
      expect.objectContaining({
        skillVersionId: versionId,
        skillSlug: 'greeter',
        version: '1.0.0',
      }),
    ]);
    expect(spec?.readOnlyMounts).toEqual([
      expect.objectContaining({
        containerPath: '/home/agent/.claude/skills/greeter',
        hostPath: expect.stringMatching(new RegExp(`${skill.id}/1\\.0\\.0$`)) as unknown,
      }),
    ]);
  });

  it('marks a run failed with the provider error when authentication fails', async () => {
    const agent = await createAgent({ name: 'bad-key' });
    const run = await launchAndFinish(agent.id, {
      stdoutLines: readFixtureLines('claude-code-auth-failure.jsonl'),
      exitCode: 1,
    });

    expect(run).toMatchObject({
      status: 'failed',
      exitCode: 1,
      errorMessage: 'Failed to authenticate. API Error: 401 API key is invalid.',
    });
  });

  it('marks a run failed when the sandbox cannot start', async () => {
    const agent = await createAgent({ name: 'no-docker' });
    const run = await launchAndFinish(agent.id, {
      stdoutLines: [],
      exitCode: 0,
      shouldFailToStart: true,
    });

    expect(run).toMatchObject({
      status: 'failed',
      errorMessage: 'The run could not be executed; see the API log',
    });
  });

  it('redacts the API key and other secrets from stored events', async () => {
    const leakedKey = TEST_PROVIDER_API_KEYS.ANTHROPIC_API_KEY;
    const agent = await createAgent({ name: 'leaky' });
    const run = await launchAndFinish(agent.id, {
      stdoutLines: [
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: `key is ${leakedKey}` }] },
        }),
      ],
      stderrLines: [`env: ANTHROPIC_API_KEY=${leakedKey}`, `token ghp_${'x'.repeat(36)}`],
      exitCode: 0,
    });
    const storedRows = await ownerDatabase('run_events')
      .where({ run_id: run.id })
      .select('payload', 'raw_payload');
    const storedText = JSON.stringify(storedRows);

    expect(storedText).not.toContain(leakedKey);
    expect(storedText).not.toContain('ghp_');
    expect(storedText).toContain('[REDACTED]');
  });

  it('estimates cost from the model price table when the provider reports only tokens', async () => {
    await adminAgent.put('/api/model-prices').set('Origin', TEST_APP_ORIGIN).send({
      providerId: codexProviderId,
      model: 'gpt-test',
      inputMicroUsdPerMillionTokens: 1_250_000,
      cachedInputMicroUsdPerMillionTokens: 125_000,
      outputMicroUsdPerMillionTokens: 10_000_000,
    });
    const agent = await createAgent({
      name: 'codex-priced',
      providerId: codexProviderId,
      model: 'gpt-test',
    });
    const run = await launchAndFinish(agent.id, {
      stdoutLines: readFixtureLines('codex-success.jsonl'),
      exitCode: 0,
    });

    expect(run).toMatchObject({
      status: 'succeeded',
      inputTokens: 4_297,
      cacheReadTokens: 37_120,
      outputTokens: 108,
      costMicroUsd: 11_091,
      costSource: 'estimated',
    });
  });

  it('leaves cost empty when no price is known for the model', async () => {
    const agent = await createAgent({ name: 'codex-unpriced', providerId: codexProviderId });
    const run = await launchAndFinish(agent.id, {
      stdoutLines: readFixtureLines('codex-success.jsonl'),
      exitCode: 0,
    });
    const usage = AgentUsageSchema.parse(
      (await viewerAgent.get(`/api/agents/${agent.id}/usage`)).body,
    );

    expect(run).toMatchObject({ costMicroUsd: null, costSource: null, outputTokens: 108 });
    expect(usage).toMatchObject({ runCount: 1, unpricedRunCount: 1, costMicroUsd: 0 });
  });
});

describe('launch rules', () => {
  it('does not let viewers launch runs', async () => {
    const agent = await createAgent({ name: 'viewer-target' });
    const response = await viewerAgent
      .post('/api/runs')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ agentId: agent.id, prompt: 'hi' });

    expect(response.status).toBe(403);
  });

  it('refuses archived agents', async () => {
    const agent = await createAgent({ name: 'archived-agent' });
    await operatorAgent.post(`/api/agents/${agent.id}/archive`).set('Origin', TEST_APP_ORIGIN);
    const response = await operatorAgent
      .post('/api/runs')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ agentId: agent.id, prompt: 'hi' });

    expect(response.status).toBe(409);
  });

  it('answers 503 when the provider key is not configured, without creating a run', async () => {
    const { app: keylessApp } = createTestAppWithRuns(appDatabase, {
      runs: { maxConcurrentRuns: 2, providerApiKeys: {} },
    });
    const operator = (await createSignedInUser(keylessApp, appDatabase, 'operator')).agent;
    const agent = await createAgent({ name: 'keyless' });
    const response = await operator
      .post('/api/runs')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ agentId: agent.id, prompt: 'hi' });
    const runs = RunListPageSchema.parse(
      (await viewerAgent.get(`/api/runs?agentId=${agent.id}`)).body,
    );

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      error: {
        code: 'service_unavailable',
        message: expect.stringContaining('ANTHROPIC_API_KEY') as unknown,
      },
    });
    expect(runs.items).toEqual([]);
  });

  it('refuses a launch beyond MAX_CONCURRENT_RUNS', async () => {
    const agent = await createAgent({ name: 'busy' });
    const firstRun = await launchRun(agent.id, WAIT_FOR_STOP_SCRIPT);
    const secondRun = await launchRun(agent.id, WAIT_FOR_STOP_SCRIPT);
    const response = await operatorAgent
      .post('/api/runs')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ agentId: agent.id, prompt: 'one more' });

    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({ error: { code: 'capacity_reached' } });

    for (const run of [firstRun, secondRun]) {
      await operatorAgent.post(`/api/runs/${run.id}/cancel`).set('Origin', TEST_APP_ORIGIN);
      await runManager.waitForRun(run.id);
    }
  });
});

describe('cancelling a run', () => {
  it('stops the sandbox, marks the run cancelled and audits it', async () => {
    const agent = await createAgent({ name: 'cancel-me' });
    const run = await launchRun(agent.id, WAIT_FOR_STOP_SCRIPT);
    await waitForStatus(run.id, 'running');

    const response = await operatorAgent
      .post(`/api/runs/${run.id}/cancel`)
      .set('Origin', TEST_APP_ORIGIN);
    await runManager.waitForRun(run.id);
    const cancelledRun = await getRun(run.id);
    const auditPage = AuditLogPageSchema.parse(
      (await operatorAgent.get(`/api/audit-log?targetType=run&targetId=${run.id}`)).body,
    );

    expect(response.status).toBe(200);
    expect(cancelledRun).toMatchObject({
      status: 'cancelled',
      errorMessage: 'Cancelled by a user',
    });
    expect(auditPage.items.map((entry) => entry.action)).toEqual(['run.cancelled', 'run.launched']);
  });

  it('refuses to cancel a finished run', async () => {
    const agent = await createAgent({ name: 'already-done' });
    const run = await launchAndFinish(agent.id);
    const response = await operatorAgent
      .post(`/api/runs/${run.id}/cancel`)
      .set('Origin', TEST_APP_ORIGIN);

    expect(response.status).toBe(409);
  });
});

describe('streaming run events', () => {
  it('replays stored events after Last-Event-ID and ends after the terminal status', async () => {
    const agent = await createAgent({ name: 'streamed' });
    const run = await launchAndFinish(agent.id);

    const fullStream = await viewerAgent.get(`/api/runs/${run.id}/stream`).buffer(true);
    const resumedStream = await viewerAgent
      .get(`/api/runs/${run.id}/stream`)
      .set('Last-Event-ID', '4')
      .buffer(true);

    expect(fullStream.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(fullStream.text.match(/^id: \d+$/gm)).toEqual([
      'id: 0',
      'id: 1',
      'id: 2',
      'id: 3',
      'id: 4',
      'id: 5',
      'id: 6',
    ]);
    expect(fullStream.text.trimEnd().endsWith('event: end\ndata: {}')).toBe(true);
    expect(resumedStream.text.match(/^id: \d+$/gm)).toEqual(['id: 5', 'id: 6']);
  });

  it('answers 404 as JSON for an unknown run', async () => {
    const response = await viewerAgent.get('/api/runs/00000000-0000-7000-8000-000000000000/stream');

    expect(response.status).toBe(404);
  });
});

describe('listing runs', () => {
  it('pages newest first and filters by status', async () => {
    const agent = await createAgent({ name: 'paged' });
    const olderRun = await launchAndFinish(agent.id);
    const newerRun = await launchAndFinish(agent.id);

    const firstPage = RunListPageSchema.parse(
      (await viewerAgent.get(`/api/runs?agentId=${agent.id}&limit=1`)).body,
    );
    const secondPage = RunListPageSchema.parse(
      (
        await viewerAgent.get(
          `/api/runs?agentId=${agent.id}&limit=1&before=${firstPage.nextCursor ?? ''}`,
        )
      ).body,
    );
    const failedRuns = RunListPageSchema.parse(
      (await viewerAgent.get(`/api/runs?agentId=${agent.id}&status=failed`)).body,
    );

    expect(firstPage.items.map((run) => run.id)).toEqual([newerRun.id]);
    expect(secondPage.items.map((run) => run.id)).toEqual([olderRun.id]);
    expect(secondPage.nextCursor).toBeNull();
    expect(failedRuns.items).toEqual([]);
  });

  it('totals usage per agent', async () => {
    const agent = await createAgent({ name: 'totals' });
    await launchAndFinish(agent.id);
    await launchAndFinish(agent.id);

    const usage = AgentUsageSchema.parse(
      (await viewerAgent.get(`/api/agents/${agent.id}/usage`)).body,
    );

    expect(usage).toEqual({
      runCount: 2,
      activeRunCount: 0,
      inputTokens: 200,
      outputTokens: 40,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 100,
      costMicroUsd: 25_000,
      monthToDateCostMicroUsd: 25_000,
      unpricedRunCount: 0,
    });
  });
});

describe('run workspaces', () => {
  it('lists and downloads files, but never follows symlinks', async () => {
    const agent = await createAgent({ name: 'workspace-files' });
    const run = await launchAndFinish(agent.id);
    const workspaceDirectory = join(runDataDirectory, run.id, 'workspace');
    await mkdir(join(workspaceDirectory, 'src'), { recursive: true });
    await writeFile(join(workspaceDirectory, 'src', 'answer.txt'), '42\n');
    await symlink('/etc/hostname', join(workspaceDirectory, 'escape.txt'));

    const listing = WorkspaceListingSchema.parse(
      (await viewerAgent.get(`/api/runs/${run.id}/workspace`)).body,
    );
    const download = await viewerAgent
      .get(`/api/runs/${run.id}/workspace/file?path=src/answer.txt`)
      .buffer(true);
    const symlinkDownload = await viewerAgent.get(
      `/api/runs/${run.id}/workspace/file?path=escape.txt`,
    );
    const traversal = await viewerAgent.get(`/api/runs/${run.id}/workspace/file?path=../home/x`);

    expect(listing).toEqual({
      items: [expect.objectContaining({ path: 'src/answer.txt', sizeBytes: 3 })],
      isTruncated: false,
    });
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('application/octet-stream');
    expect(download.headers['content-disposition']).toBe("attachment; filename*=UTF-8''answer.txt");
    expect(String(download.body)).toBe('42\n');
    expect(symlinkDownload.status).toBe(404);
    expect(traversal.status).toBe(404);
  });

  it('removes the run HOME after the run', async () => {
    const agent = await createAgent({ name: 'home-cleanup' });
    const run = await launchAndFinish(agent.id);

    await expect(
      import('node:fs/promises').then((fs) => fs.stat(join(runDataDirectory, run.id, 'home'))),
    ).rejects.toThrow();
  });
});

describe('recovering interrupted runs', () => {
  it('fails runs left active by a previous process and appends a status event', async () => {
    const agent = await createAgent({ name: 'interrupted' });
    const [row] = await appDatabase('agent_runs')
      .insert({
        agent_id: agent.id,
        provider_id: claudeProviderId,
        prompt: 'stranded',
        status: 'running',
        started_at: appDatabase.fn.now(),
      })
      .returning<{ id: string }[]>('id');
    const runId = row?.id ?? '';
    await appDatabase('run_events').insert({
      run_id: runId,
      sequence_number: 0,
      event_type: 'run.status',
      payload: JSON.stringify({ status: 'running', message: null }),
    });

    await runManager.recoverInterruptedRuns();
    const recoveredRun = await getRun(runId);
    const events = await listEvents(runId);

    expect(recoveredRun).toMatchObject({ status: 'failed', errorMessage: INTERRUPTED_RUN_MESSAGE });
    expect(events.at(-1)).toMatchObject({
      sequenceNumber: 1,
      payload: { status: 'failed', message: INTERRUPTED_RUN_MESSAGE },
    });
  });
});

describe('model prices', () => {
  it('lets only admins change prices', async () => {
    const response = await operatorAgent
      .put('/api/model-prices')
      .set('Origin', TEST_APP_ORIGIN)
      .send({
        providerId: codexProviderId,
        model: 'gpt-other',
        inputMicroUsdPerMillionTokens: 1,
        cachedInputMicroUsdPerMillionTokens: 1,
        outputMicroUsdPerMillionTokens: 1,
      });

    expect(response.status).toBe(403);
  });

  it('replaces the price of the same model instead of duplicating it', async () => {
    const body = {
      providerId: codexProviderId,
      model: 'gpt-replace',
      inputMicroUsdPerMillionTokens: 1,
      cachedInputMicroUsdPerMillionTokens: 1,
      outputMicroUsdPerMillionTokens: 1,
    };
    const admin = await signIn(
      app,
      (await createSignedInUser(app, appDatabase, 'admin')).user.username,
    );
    const first = await admin.put('/api/model-prices').set('Origin', TEST_APP_ORIGIN).send(body);
    const second = await admin
      .put('/api/model-prices')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ ...body, outputMicroUsdPerMillionTokens: 2 });
    const deleteResponse = await admin
      .delete(`/api/model-prices/${(second.body as { id: string }).id}`)
      .set('Origin', TEST_APP_ORIGIN);

    expect((first.body as { id: string }).id).toBe((second.body as { id: string }).id);
    expect(second.body).toMatchObject({ outputMicroUsdPerMillionTokens: 2 });
    expect(deleteResponse.status).toBe(204);
  });
});
