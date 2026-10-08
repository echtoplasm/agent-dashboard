// @vitest-environment jsdom
/**
 * Tests for registry page behaviour that is easy to get wrong: surfacing
 * permission violations on assignment, and validating skill uploads before
 * they are sent.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Agent, Provider, Skill, SkillVersionSummary } from '@agent-dashboard/shared';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../App.js';
import { AuthProvider } from '../auth/AuthContext.js';
import { TEST_OPERATOR, installFakeApi } from '../test/fake-api.js';
import type { FakeRoutes } from '../test/fake-api.js';

const PROVIDER: Provider = {
  id: '01900000-0000-7000-8000-0000000000a1',
  slug: 'claude_code',
  displayName: 'Claude Code',
  cliCommand: 'claude',
  defaultArgs: ['--print'],
  skillsDirectory: null,
  isEnabled: true,
  createdAt: '2026-10-06T12:00:00.000Z',
  updatedAt: '2026-10-06T12:00:00.000Z',
};

const AGENT: Agent = {
  id: '01900000-0000-7000-8000-0000000000b1',
  name: 'docs-writer',
  description: '',
  providerId: PROVIDER.id,
  sandboxProfileId: '01900000-0000-7000-8000-0000000000c1',
  model: null,
  maxCostPerRunMicroUsd: 2_500_000,
  maxCostPerMonthMicroUsd: null,
  createdBy: null,
  archivedAt: null,
  createdAt: '2026-10-06T12:00:00.000Z',
  updatedAt: '2026-10-06T12:00:00.000Z',
};

const SKILL: Skill = {
  id: '01900000-0000-7000-8000-0000000000d1',
  slug: 'fetch-packages',
  name: 'Fetch packages',
  description: '',
  supportedProviderIds: [PROVIDER.id],
  latestVersion: '1.0.0',
  createdBy: null,
  archivedAt: null,
  createdAt: '2026-10-06T12:00:00.000Z',
  updatedAt: '2026-10-06T12:00:00.000Z',
};

const SKILL_VERSION: SkillVersionSummary = {
  id: '01900000-0000-7000-8000-0000000000e1',
  skillId: SKILL.id,
  version: '1.0.0',
  contentHash: 'a'.repeat(64),
  permissionsManifest: {
    manifestVersion: 1,
    network: { isAllowed: true, allowedHosts: ['registry.npmjs.org'] },
    filesystem: { writablePaths: [] },
    commands: { allowedCommands: [] },
  },
  changelog: '',
  publishedBy: null,
  publishedAt: '2026-10-06T12:00:00.000Z',
};

const EMPTY_AGENT_RUN_ROUTES: FakeRoutes = {
  [`GET /api/agents/${AGENT.id}/usage`]: {
    status: 200,
    body: {
      runCount: 0,
      activeRunCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costMicroUsd: 0,
      monthToDateCostMicroUsd: 0,
      unpricedRunCount: 0,
    },
  },
  [`GET /api/runs?agentId=${AGENT.id}&limit=5`]: {
    status: 200,
    body: { items: [], nextCursor: null },
  },
};

const BASE_ROUTES: FakeRoutes = {
  ...EMPTY_AGENT_RUN_ROUTES,
  'GET /api/auth/me': { status: 200, body: { user: TEST_OPERATOR } },
  'GET /api/providers': { status: 200, body: { items: [PROVIDER] } },
  'GET /api/sandbox-profiles?includeArchived=true': { status: 200, body: { items: [] } },
};

function renderAt(path: string, routes: FakeRoutes): ReturnType<typeof installFakeApi> {
  const fakeFetch = installFakeApi({ ...BASE_ROUTES, ...routes });
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
  return fakeFetch;
}

describe('agent loadout', () => {
  it('lists each permission the sandbox profile refuses', async () => {
    renderAt(`/agents/${AGENT.id}`, {
      [`GET /api/agents/${AGENT.id}`]: { status: 200, body: AGENT },
      [`GET /api/agents/${AGENT.id}/skills`]: { status: 200, body: { items: [] } },
      'GET /api/skills': { status: 200, body: { items: [SKILL] } },
      [`GET /api/skills/${SKILL.id}/versions`]: { status: 200, body: { items: [SKILL_VERSION] } },
      [`PUT /api/agents/${AGENT.id}/skills/${SKILL.id}`]: {
        status: 409,
        body: {
          error: {
            code: 'conflict',
            message: 'Fetch packages 1.0.0 cannot be assigned to this agent',
            fieldProblems: [
              {
                path: 'network.isAllowed',
                message: 'The skill needs network access but the sandbox profile disallows it',
              },
            ],
          },
        },
      },
    });

    const skillSelect = await screen.findByLabelText('Skill');
    await within(skillSelect).findByRole('option', { name: SKILL.name });
    fireEvent.change(skillSelect, { target: { value: SKILL.id } });
    const versionSelect = screen.getByLabelText('Version');
    await within(versionSelect).findByRole('option', { name: '1.0.0' });
    fireEvent.change(versionSelect, { target: { value: SKILL_VERSION.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('cannot be assigned');
    expect(alert.textContent).toContain('network.isAllowed');
  });

  it('shows budgets in dollars', async () => {
    renderAt(`/agents/${AGENT.id}`, {
      [`GET /api/agents/${AGENT.id}`]: { status: 200, body: AGENT },
      [`GET /api/agents/${AGENT.id}/skills`]: { status: 200, body: { items: [] } },
      'GET /api/skills': { status: 200, body: { items: [] } },
    });

    expect(await screen.findByText('$2.50')).toBeDefined();
  });
});

describe('publishing a skill version', () => {
  it('catches a SKILL.md without frontmatter before sending anything', async () => {
    const fakeFetch = renderAt(`/skills/${SKILL.id}`, {
      [`GET /api/skills/${SKILL.id}`]: { status: 200, body: SKILL },
      [`GET /api/skills/${SKILL.id}/versions`]: { status: 200, body: { items: [] } },
    });

    const markdownInput = await screen.findByLabelText('SKILL.md');
    fireEvent.change(markdownInput, { target: { value: '# No frontmatter here' } });
    fireEvent.change(screen.getByLabelText('Version'), { target: { value: '1.1.0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish version' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('frontmatter');
    const publishCalls = fakeFetch.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(publishCalls).toEqual([]);
  });
});
