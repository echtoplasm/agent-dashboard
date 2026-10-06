/**
 * Integration tests for session expiry, driven by a controllable clock.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabaseClients,
  resetTestDatabase,
} from '../../../test/database-test-helpers.js';
import { TEST_USER_PASSWORD, createTestUser } from '../../../test/test-app.js';
import { createDataAccess } from '../../db/data-access.js';
import { SYSTEM_AUDIT_CONTEXT } from '../audit/audit.types.js';
import { SESSION_TIMING, createAuthService } from './auth.service.js';

const ONE_MINUTE_MS = 60 * 1000;

const { ownerDatabase, appDatabase } = createTestDatabaseClients();

/** A clock tests can move forward. */
function createTestClock(): {
  getCurrentTime: () => Date;
  advanceBy: (milliseconds: number) => void;
} {
  let currentTimeMs = Date.now();
  return {
    getCurrentTime: () => new Date(currentTimeMs),
    advanceBy: (milliseconds) => {
      currentTimeMs += milliseconds;
    },
  };
}

async function signInWithClock() {
  const clock = createTestClock();
  const authService = createAuthService({
    dataAccess: createDataAccess(appDatabase),
    getCurrentTime: clock.getCurrentTime,
  });
  const user = await createTestUser(appDatabase, 'viewer');
  const { sessionToken } = await authService.login(
    { username: user.username, password: TEST_USER_PASSWORD },
    SYSTEM_AUDIT_CONTEXT,
  );
  return { authService, clock, sessionToken };
}

beforeAll(async () => {
  await resetTestDatabase(ownerDatabase);
});

afterAll(async () => {
  await Promise.all([ownerDatabase.destroy(), appDatabase.destroy()]);
});

describe('session expiry', () => {
  it('ends a session left idle past the idle timeout', async () => {
    const { authService, clock, sessionToken } = await signInWithClock();

    clock.advanceBy(SESSION_TIMING.IDLE_TIMEOUT_MS - ONE_MINUTE_MS);
    expect(await authService.authenticateSessionToken(sessionToken)).toBeDefined();

    clock.advanceBy(SESSION_TIMING.IDLE_TIMEOUT_MS + ONE_MINUTE_MS);
    expect(await authService.authenticateSessionToken(sessionToken)).toBeUndefined();
  });

  it('keeps an active session alive, but never past the absolute lifetime', async () => {
    const { authService, clock, sessionToken } = await signInWithClock();
    const activityGapMs = SESSION_TIMING.IDLE_TIMEOUT_MS / 2;
    const checksBeforeLifetimeEnds = Math.floor(
      SESSION_TIMING.ABSOLUTE_LIFETIME_MS / activityGapMs,
    );

    for (let check = 1; check < checksBeforeLifetimeEnds; check += 1) {
      clock.advanceBy(activityGapMs);
      expect(await authService.authenticateSessionToken(sessionToken)).toBeDefined();
    }

    clock.advanceBy(activityGapMs + ONE_MINUTE_MS);
    expect(await authService.authenticateSessionToken(sessionToken)).toBeUndefined();
  });

  it('rejects an unknown token', async () => {
    const { authService } = await signInWithClock();

    expect(await authService.authenticateSessionToken('not-a-real-token')).toBeUndefined();
  });
});
