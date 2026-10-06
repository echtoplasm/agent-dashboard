/**
 * Integration tests for sign-in, sessions, CSRF protection, rate limiting
 * and role checks, through the full app and the real test database.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabaseClients,
  resetTestDatabase,
} from '../../../test/database-test-helpers.js';
import {
  TEST_APP_ORIGIN,
  TEST_USER_PASSWORD,
  createSignedInUser,
  createTestApp,
  createTestUser,
  signIn,
} from '../../../test/test-app.js';

const { ownerDatabase, appDatabase } = createTestDatabaseClients();
const app = createTestApp(appDatabase);

async function findLatestAuditAction(): Promise<string | undefined> {
  const entry = await appDatabase('audit_log')
    .orderBy('id', 'desc')
    .first<{ action: string } | undefined>('action');
  return entry?.action;
}

beforeAll(async () => {
  await resetTestDatabase(ownerDatabase);
});

afterAll(async () => {
  await Promise.all([ownerDatabase.destroy(), appDatabase.destroy()]);
});

describe('POST /api/auth/login', () => {
  it('sets an HttpOnly, SameSite=Strict session cookie and returns the user', async () => {
    const user = await createTestUser(appDatabase, 'viewer');

    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ username: user.username, password: TEST_USER_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ user: { id: user.id, username: user.username } });
    const [sessionCookie] = response.get('set-cookie') ?? [];
    expect(sessionCookie).toMatch(/^agent_dashboard_session=/);
    expect(sessionCookie).toMatch(/HttpOnly/);
    expect(sessionCookie).toMatch(/SameSite=Strict/);
    expect(await findLatestAuditAction()).toBe('auth.login_succeeded');
  });

  it('accepts the username in any case', async () => {
    const user = await createTestUser(appDatabase, 'viewer');

    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ username: user.username.toUpperCase(), password: TEST_USER_PASSWORD });

    expect(response.status).toBe(200);
  });

  it('gives the same 401 for a wrong password and an unknown user, and audits both', async () => {
    const user = await createTestUser(appDatabase, 'viewer');

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ username: user.username, password: 'not-the-password' });
    expect(await findLatestAuditAction()).toBe('auth.login_failed');
    const unknownUser = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ username: 'nobody-here', password: 'not-the-password' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownUser.body);
    expect(await findLatestAuditAction()).toBe('auth.login_failed');
  });

  it('refuses deactivated users', async () => {
    const user = await createTestUser(appDatabase, 'viewer');
    await appDatabase('users').where({ id: user.id }).update({ is_active: false });

    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ username: user.username, password: TEST_USER_PASSWORD });

    expect(response.status).toBe(401);
  });

  it('rate limits repeated failed logins from one IP', async () => {
    const strictApp = createTestApp(appDatabase, {
      rateLimits: { apiRequestsPerMinute: 1_000, failedLoginsPerWindow: 2 },
    });
    const attemptLogin = () =>
      request(strictApp)
        .post('/api/auth/login')
        .set('Origin', TEST_APP_ORIGIN)
        .send({ username: 'nobody-here', password: 'wrong-password' });

    await attemptLogin();
    await attemptLogin();
    const blockedResponse = await attemptLogin();

    expect(blockedResponse.status).toBe(429);
    expect(blockedResponse.body).toMatchObject({ error: { code: 'rate_limited' } });
  });
});

describe('session lifecycle', () => {
  it('lets a signed-in user read /me and then sign out', async () => {
    const { user, agent } = await createSignedInUser(app, appDatabase, 'operator');

    const meResponse = await agent.get('/api/auth/me');
    expect(meResponse.status).toBe(200);
    expect(meResponse.body).toMatchObject({ user: { id: user.id } });

    const logoutResponse = await agent.post('/api/auth/logout').set('Origin', TEST_APP_ORIGIN);
    expect(logoutResponse.status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('stores only the hash of the session token', async () => {
    const user = await createTestUser(appDatabase, 'viewer');
    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ username: user.username, password: TEST_USER_PASSWORD });
    const sessionToken = /agent_dashboard_session=([^;]+)/.exec(
      response.get('set-cookie')?.[0] ?? '',
    )?.[1];

    const storedHashes = await appDatabase('sessions')
      .where({ user_id: user.id })
      .pluck<string[]>('token_hash');
    expect(sessionToken).toBeDefined();
    expect(storedHashes).toHaveLength(1);
    expect(storedHashes[0]).not.toBe(sessionToken);
    expect(storedHashes[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ends every session when the user is deactivated', async () => {
    const { user, agent } = await createSignedInUser(app, appDatabase, 'viewer');

    await appDatabase('users').where({ id: user.id }).update({ is_active: false });

    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('changing your password keeps this session but ends the others', async () => {
    const { user, agent: currentAgent } = await createSignedInUser(app, appDatabase, 'viewer');
    const otherAgent = await signIn(app, user.username);

    const response = await currentAgent
      .post('/api/auth/password')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ currentPassword: TEST_USER_PASSWORD, newPassword: 'a-brand-new-password' });

    expect(response.status).toBe(204);
    expect((await currentAgent.get('/api/auth/me')).status).toBe(200);
    expect((await otherAgent.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects a password change with the wrong current password', async () => {
    const { agent } = await createSignedInUser(app, appDatabase, 'viewer');

    const response = await agent
      .post('/api/auth/password')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ currentPassword: 'wrong-current-password', newPassword: 'a-brand-new-password' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { fieldProblems: [{ path: 'currentPassword' }] },
    });
  });
});

describe('cross-site request protection', () => {
  it('blocks state-changing requests without an Origin or Referer', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'x', password: 'y' });

    expect(response.status).toBe(403);
  });

  it('blocks state-changing requests from another origin', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ username: 'x', password: 'y' });

    expect(response.status).toBe(403);
  });

  it('accepts a matching Referer when Origin is absent', async () => {
    const user = await createTestUser(appDatabase, 'viewer');

    const response = await request(app)
      .post('/api/auth/login')
      .set('Referer', `${TEST_APP_ORIGIN}/login`)
      .send({ username: user.username, password: TEST_USER_PASSWORD });

    expect(response.status).toBe(200);
  });

  it('rejects non-JSON bodies with 415', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_APP_ORIGIN)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('username=x&password=y');

    expect(response.status).toBe(415);
  });

  it('does not check safe methods', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
});

describe('protected routes', () => {
  it('return 401 without a session, even for unknown paths', async () => {
    expect((await request(app).get('/api/users')).status).toBe(401);
    expect((await request(app).get('/api/no-such-route')).status).toBe(401);
  });

  it('return 403 when the role is not allowed', async () => {
    const { agent } = await createSignedInUser(app, appDatabase, 'operator');

    expect((await agent.get('/api/users')).status).toBe(403);
  });

  it('let an admin list and create users', async () => {
    const { agent } = await createSignedInUser(app, appDatabase, 'admin');

    const createResponse = await agent
      .post('/api/users')
      .set('Origin', TEST_APP_ORIGIN)
      .send({ username: 'new-viewer', role: 'viewer', password: 'new-viewer-password' });
    const listResponse = await agent.get('/api/users');

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).not.toHaveProperty('passwordHash');
    expect(listResponse.status).toBe(200);
    expect(JSON.stringify(listResponse.body)).not.toMatch(/scrypt\$/);
  });
});
