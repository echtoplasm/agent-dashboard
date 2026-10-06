// @vitest-environment jsdom
/**
 * Tests for sign-in and route protection, rendering the real route table
 * against a fake API.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from './App.js';
import { AuthProvider } from './auth/AuthContext.js';
import { TEST_OPERATOR, UNAUTHENTICATED_RESPONSE, installFakeApi } from './test/fake-api.js';
import type { FakeRoutes } from './test/fake-api.js';

const HEALTHY_RESPONSE = {
  status: 200,
  body: {
    status: 'ok',
    checks: { database: 'up' },
    uptimeSeconds: 5,
    checkedAt: '2026-10-06T12:00:00.000Z',
  },
};

function renderApp(initialPath: string, routes: FakeRoutes): void {
  installFakeApi({ 'GET /api/health': HEALTHY_RESPONSE, ...routes });
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function fillSignInForm(username: string, password: string): void {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('route protection', () => {
  it('sends signed-out visitors to the sign-in page', async () => {
    renderApp('/account', { 'GET /api/auth/me': UNAUTHENTICATED_RESPONSE });

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeDefined();
  });

  it('shows the page when a session exists', async () => {
    renderApp('/account', {
      'GET /api/auth/me': { status: 200, body: { user: TEST_OPERATOR } },
    });

    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeDefined();
  });
});

describe('signing in', () => {
  it('returns to the page the user asked for', async () => {
    renderApp('/account', {
      'GET /api/auth/me': UNAUTHENTICATED_RESPONSE,
      'POST /api/auth/login': { status: 200, body: { user: TEST_OPERATOR } },
    });

    await screen.findByRole('button', { name: 'Sign in' });
    fillSignInForm('olivia', 'correct-password');

    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeDefined();
  });

  it('shows the API error and clears the password on failure', async () => {
    renderApp('/', {
      'GET /api/auth/me': UNAUTHENTICATED_RESPONSE,
      'POST /api/auth/login': {
        status: 401,
        body: { error: { code: 'unauthenticated', message: 'Invalid username or password' } },
      },
    });

    await screen.findByRole('button', { name: 'Sign in' });
    fillSignInForm('olivia', 'wrong-password');

    expect(await screen.findByText('Invalid username or password')).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>('Password').value).toBe('');
  });

  it('shows admin-only navigation only to admins', async () => {
    renderApp('/', { 'GET /api/auth/me': { status: 200, body: { user: TEST_OPERATOR } } });

    await screen.findByRole('heading', { name: 'Overview' });

    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeDefined();
  });
});
