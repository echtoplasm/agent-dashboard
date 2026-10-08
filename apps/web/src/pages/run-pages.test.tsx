// @vitest-environment jsdom
/**
 * Tests for the run pages: launching from an agent, following a run's live
 * output, and cancelling it.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Agent, AgentUsage, RunDetail, RunEvent, RunEventData } from '@agent-dashboard/shared';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App.js';
import { AuthProvider } from '../auth/AuthContext.js';
import { TEST_OPERATOR, installFakeApi } from '../test/fake-api.js';
import type { FakeRoutes } from '../test/fake-api.js';
import { installFakeEventSource } from '../test/fake-event-source.js';

const AGENT: Agent = {
  id: '01900000-0000-7000-8000-0000000000b1',
  name: 'docs-writer',
  description: '',
  providerId: '01900000-0000-7000-8000-0000000000a1',
  sandboxProfileId: '01900000-0000-7000-8000-0000000000c1',
  model: null,
  maxCostPerRunMicroUsd: null,
  maxCostPerMonthMicroUsd: null,
  createdBy: null,
  archivedAt: null,
  createdAt: '2026-10-06T12:00:00.000Z',
  updatedAt: '2026-10-06T12:00:00.000Z',
};

const RUNNING_RUN: RunDetail = {
  id: '01900000-0000-7000-8000-0000000000f1',
  agentId: AGENT.id,
  agentName: AGENT.name,
  providerId: AGENT.providerId,
  providerSlug: 'claude_code',
  triggeredBy: TEST_OPERATOR.id,
  triggeredByUsername: TEST_OPERATOR.username,
  status: 'running',
  model: 'claude-opus-5-5',
  queuedAt: '2026-10-08T10:00:00.000Z',
  startedAt: '2026-10-08T10:00:01.000Z',
  endedAt: null,
  exitCode: null,
  errorMessage: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  costMicroUsd: null,
  costSource: null,
  prompt: 'Write the README',
  sandboxId: 'agent-run-x',
  providerSessionId: null,
  skillVersions: [],
};

const EMPTY_USAGE: AgentUsage = {
  runCount: 0,
  activeRunCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costMicroUsd: 0,
  monthToDateCostMicroUsd: 0,
  unpricedRunCount: 0,
};

const BASE_ROUTES: FakeRoutes = {
  'GET /api/auth/me': { status: 200, body: { user: TEST_OPERATOR } },
  'GET /api/providers': { status: 200, body: { items: [] } },
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

function toStoredEvent(data: RunEventData, sequenceNumber: number): RunEvent {
  return {
    ...data,
    runId: RUNNING_RUN.id,
    sequenceNumber,
    occurredAt: null,
    receivedAt: '2026-10-08T10:00:02.000Z',
  };
}

describe('launching a run from an agent', () => {
  it('sends the prompt and opens the new run', async () => {
    installFakeEventSource();
    const fakeFetch = renderAt(`/agents/${AGENT.id}`, {
      [`GET /api/agents/${AGENT.id}`]: { status: 200, body: AGENT },
      [`GET /api/agents/${AGENT.id}/skills`]: { status: 200, body: { items: [] } },
      [`GET /api/agents/${AGENT.id}/usage`]: { status: 200, body: EMPTY_USAGE },
      [`GET /api/runs?agentId=${AGENT.id}&limit=5`]: {
        status: 200,
        body: { items: [], nextCursor: null },
      },
      'GET /api/skills': { status: 200, body: { items: [] } },
      'POST /api/runs': { status: 201, body: { ...RUNNING_RUN, status: 'queued' } },
      [`GET /api/runs/${RUNNING_RUN.id}`]: { status: 200, body: RUNNING_RUN },
    });

    fireEvent.change(await screen.findByLabelText('Prompt'), {
      target: { value: 'Write the README' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Launch run' }));

    expect(await screen.findByText('Write the README', { selector: 'pre' })).toBeDefined();
    const launchCall = fakeFetch.mock.calls.find(
      ([url, init]) => url === '/api/runs' && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(JSON.parse((launchCall?.[1] as RequestInit).body as string)).toEqual({
      agentId: AGENT.id,
      prompt: 'Write the README',
    });
  });
});

describe('following a run', () => {
  it('shows streamed output with tool calls paired to their results', async () => {
    const eventSourceClass = installFakeEventSource();
    renderAt(`/runs/${RUNNING_RUN.id}`, {
      [`GET /api/runs/${RUNNING_RUN.id}`]: { status: 200, body: RUNNING_RUN },
    });
    await screen.findByText('Write the README');
    const [eventSource] = eventSourceClass.instances;

    act(() => {
      eventSource?.emit(
        'run-event',
        toStoredEvent(
          {
            type: 'tool.call',
            payload: {
              toolCallId: 't1',
              toolName: 'Bash',
              input: { command: 'ls -la' },
              parentToolCallId: null,
            },
          },
          0,
        ),
      );
      eventSource?.emit(
        'run-event',
        toStoredEvent(
          {
            type: 'tool.result',
            payload: {
              toolCallId: 't1',
              isError: false,
              output: 'README.md',
              isOutputTruncated: false,
              exitCode: 0,
            },
          },
          1,
        ),
      );
      eventSource?.emit(
        'run-event',
        toStoredEvent(
          { type: 'assistant.text', payload: { text: 'Drafted it.', parentToolCallId: null } },
          2,
        ),
      );
      // A duplicate after a reconnect must not be shown twice.
      eventSource?.emit(
        'run-event',
        toStoredEvent(
          { type: 'assistant.text', payload: { text: 'Drafted it.', parentToolCallId: null } },
          2,
        ),
      );
    });

    expect(eventSource?.url).toBe(`/api/runs/${RUNNING_RUN.id}/stream`);
    expect(screen.getByText('ls -la')).toBeDefined();
    expect(screen.getByText('done (exit 0)')).toBeDefined();
    expect(screen.getAllByText('Drafted it.')).toHaveLength(1);
  });

  it('lets an operator cancel an active run', async () => {
    installFakeEventSource();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fakeFetch = renderAt(`/runs/${RUNNING_RUN.id}`, {
      [`GET /api/runs/${RUNNING_RUN.id}`]: { status: 200, body: RUNNING_RUN },
      [`POST /api/runs/${RUNNING_RUN.id}/cancel`]: {
        status: 200,
        body: { ...RUNNING_RUN, status: 'cancelled' },
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));

    await vi.waitFor(() => {
      expect(
        fakeFetch.mock.calls.some(([url]) => url === `/api/runs/${RUNNING_RUN.id}/cancel`),
      ).toBe(true);
    });
  });

  it('closes the stream when the server says the run ended', async () => {
    const eventSourceClass = installFakeEventSource();
    renderAt(`/runs/${RUNNING_RUN.id}`, {
      [`GET /api/runs/${RUNNING_RUN.id}`]: { status: 200, body: RUNNING_RUN },
    });
    await screen.findByText('Write the README');
    const [eventSource] = eventSourceClass.instances;

    act(() => {
      eventSource?.emit('end', {});
    });

    expect(eventSource?.readyState).toBe(eventSourceClass.CLOSED);
  });
});
