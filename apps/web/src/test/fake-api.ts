/**
 * A fake `fetch` for web tests: routes `METHOD /path` to canned JSON responses.
 */
import { vi } from 'vitest';
import type { User } from '@agent-dashboard/shared';

/** A canned response: status plus JSON body (omit the body for 204). */
export interface FakeResponse {
  status: number;
  body?: unknown;
}

/** Maps `"GET /api/auth/me"` style keys to responses or response factories. */
export type FakeRoutes = Record<string, FakeResponse | ((body: unknown) => FakeResponse)>;

const NOT_FOUND_RESPONSE: FakeResponse = {
  status: 404,
  body: { error: { code: 'not_found', message: 'No fake route' } },
};

/**
 * Replaces the global `fetch` with one that answers from `routes`.
 *
 * @param routes - Responses keyed by method and path (query strings included).
 * @returns The mock, for asserting on calls.
 */
export function installFakeApi(routes: FakeRoutes): ReturnType<typeof vi.fn> {
  const fakeFetch = vi.fn((input: string, init?: RequestInit) => {
    const routeKey = `${init?.method ?? 'GET'} ${input}`;
    const route = routes[routeKey];
    const requestBody: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const fakeResponse =
      route === undefined
        ? NOT_FOUND_RESPONSE
        : typeof route === 'function'
          ? route(requestBody)
          : route;
    const responseBody = fakeResponse.body === undefined ? null : JSON.stringify(fakeResponse.body);
    return Promise.resolve(new Response(responseBody, { status: fakeResponse.status }));
  });
  vi.stubGlobal('fetch', fakeFetch);
  return fakeFetch;
}

/** A signed-in operator for tests. */
export const TEST_OPERATOR: User = {
  id: '01900000-0000-7000-8000-000000000001',
  username: 'olivia',
  email: null,
  role: 'operator',
  isActive: true,
  lastLoginAt: null,
  createdAt: '2026-10-06T12:00:00.000Z',
  updatedAt: '2026-10-06T12:00:00.000Z',
};

/** The API's response when no session is present. */
export const UNAUTHENTICATED_RESPONSE: FakeResponse = {
  status: 401,
  body: { error: { code: 'unauthenticated', message: 'Sign in to continue' } },
};
