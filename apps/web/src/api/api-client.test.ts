/**
 * Tests for the API client's response validation and error handling.
 */
import { CurrentUserResponseSchema } from '@agent-dashboard/shared';
import { describe, expect, it, vi } from 'vitest';
import { TEST_OPERATOR, UNAUTHENTICATED_RESPONSE, installFakeApi } from '../test/fake-api.js';
import { ApiError, apiRequest, setUnauthenticatedListener } from './api-client.js';

describe('apiRequest', () => {
  it('returns the validated body', async () => {
    installFakeApi({ 'GET /api/auth/me': { status: 200, body: { user: TEST_OPERATOR } } });

    const response = await apiRequest('/api/auth/me', CurrentUserResponseSchema);

    expect(response.user.username).toBe('olivia');
  });

  it('turns an error body into an ApiError with field problems', async () => {
    installFakeApi({
      'POST /api/agents': {
        status: 400,
        body: {
          error: {
            code: 'validation_failed',
            message: 'Request validation failed',
            fieldProblems: [{ path: 'name', message: 'Required' }],
          },
        },
      },
    });

    const request = apiRequest('/api/agents', null, { method: 'POST', body: {} });

    await expect(request).rejects.toMatchObject({
      status: 400,
      code: 'validation_failed',
      fieldProblems: [{ path: 'name', message: 'Required' }],
    });
  });

  it('notifies the unauthenticated listener on 401', async () => {
    installFakeApi({ 'GET /api/auth/me': UNAUTHENTICATED_RESPONSE });
    const listener = vi.fn();
    setUnauthenticatedListener(listener);

    await expect(apiRequest('/api/auth/me', CurrentUserResponseSchema)).rejects.toThrow(ApiError);

    expect(listener).toHaveBeenCalledOnce();
    setUnauthenticatedListener(undefined);
  });

  it('rejects a body that does not match the schema', async () => {
    installFakeApi({ 'GET /api/auth/me': { status: 200, body: { user: { id: 'nope' } } } });

    await expect(apiRequest('/api/auth/me', CurrentUserResponseSchema)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('reports a network failure', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));

    await expect(apiRequest('/api/auth/me', CurrentUserResponseSchema)).rejects.toMatchObject({
      code: 'network_error',
    });
  });

  it('sends JSON with a content type only when there is a body', async () => {
    const fakeFetch = installFakeApi({ 'POST /api/auth/logout': { status: 204 } });

    await apiRequest('/api/auth/logout', null, { method: 'POST' });

    expect(fakeFetch).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ headers: {}, body: null, credentials: 'same-origin' }),
    );
  });
});
