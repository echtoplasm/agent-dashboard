/**
 * Tests for the health API client, using a stub `fetch`.
 */
import type { HealthResponse } from '@agent-dashboard/shared';
import { describe, expect, it } from 'vitest';
import { fetchHealthStatus } from './health.js';

const HEALTHY_REPORT: HealthResponse = {
  status: 'ok',
  checks: { database: 'up' },
  uptimeSeconds: 12,
  checkedAt: '2026-10-06T12:00:00.000Z',
};

function stubFetchResponding(status: number, body: unknown): typeof fetch {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe('fetchHealthStatus', () => {
  it('returns the report from a healthy API', async () => {
    const result = await fetchHealthStatus(stubFetchResponding(200, HEALTHY_REPORT));

    expect(result).toEqual({ kind: 'reported', healthReport: HEALTHY_REPORT });
  });

  it('still returns the report when the API is degraded (503)', async () => {
    const degradedReport = {
      ...HEALTHY_REPORT,
      status: 'degraded',
      checks: { database: 'down' },
    };

    const result = await fetchHealthStatus(stubFetchResponding(503, degradedReport));

    expect(result).toMatchObject({ kind: 'reported', healthReport: { status: 'degraded' } });
  });

  it('reports unreachable when the network request fails', async () => {
    const failingFetch: typeof fetch = () => Promise.reject(new TypeError('Failed to fetch'));

    expect(await fetchHealthStatus(failingFetch)).toMatchObject({ kind: 'unreachable' });
  });

  it('reports unreachable on an unexpected status such as a proxy 502', async () => {
    const result = await fetchHealthStatus(stubFetchResponding(502, {}));

    expect(result).toEqual({ kind: 'unreachable', reason: 'Unexpected HTTP status 502' });
  });

  it('reports unreachable when the body does not match the contract', async () => {
    const result = await fetchHealthStatus(stubFetchResponding(200, { healthy: true }));

    expect(result).toMatchObject({ kind: 'unreachable' });
  });
});
