/**
 * Client for the API health endpoint.
 *
 * Responses are validated with the shared Zod schema, so a contract change
 * on the API side fails loudly here instead of rendering garbage.
 */
import { HealthResponseSchema } from '@agent-dashboard/shared';
import type { HealthResponse } from '@agent-dashboard/shared';
import { API_BASE_URL } from './api-client.js';

const HEALTH_PATH = '/api/health';

/** Statuses the health endpoint uses: 200 when healthy, 503 when degraded. */
const HEALTH_RESPONSE_STATUSES = [200, 503];

/** Outcome of a health check from the browser's point of view. */
export type HealthCheckResult =
  { kind: 'reported'; healthReport: HealthResponse } | { kind: 'unreachable'; reason: string };

/**
 * Fetches and validates the API health report.
 *
 * A 503 still carries a report (the API is up but a dependency is down), so
 * it counts as `reported`. Network failures, unexpected statuses and invalid
 * bodies count as `unreachable`.
 *
 * @param fetchFunction - Injectable for tests; defaults to the global `fetch`.
 * @returns The health report, or why it could not be obtained.
 */
export async function fetchHealthStatus(
  fetchFunction: typeof fetch = fetch,
): Promise<HealthCheckResult> {
  let response: Response;
  try {
    response = await fetchFunction(`${API_BASE_URL}${HEALTH_PATH}`);
  } catch {
    return { kind: 'unreachable', reason: 'Could not connect to the API' };
  }

  if (!HEALTH_RESPONSE_STATUSES.includes(response.status)) {
    return { kind: 'unreachable', reason: `Unexpected HTTP status ${response.status}` };
  }

  const parsedBody = HealthResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsedBody.success) {
    return { kind: 'unreachable', reason: 'The API returned an unexpected response' };
  }
  return { kind: 'reported', healthReport: parsedBody.data };
}
