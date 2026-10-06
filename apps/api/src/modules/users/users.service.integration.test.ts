/**
 * Integration tests for the users service against the test database,
 * connected as the restricted app role.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabaseClients,
  resetTestDatabase,
} from '../../../test/database-test-helpers.js';
import { createDataAccess } from '../../db/data-access.js';
import { ConflictError } from '../../errors/app-errors.js';
import { SYSTEM_AUDIT_CONTEXT } from '../audit/audit.types.js';
import type { AuditContext } from '../audit/audit.types.js';
import { verifyPassword } from '../auth/password-hashing.js';
import { createUsersService } from './users.service.js';

const PASSWORD = 'a-long-test-password';

const { ownerDatabase, appDatabase } = createTestDatabaseClients();
const dataAccess = createDataAccess(appDatabase);
const usersService = createUsersService(dataAccess);

function uniqueUsername(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function contextFor(actorUserId: string): AuditContext {
  return { actorUserId, ipAddress: '127.0.0.1', userAgent: 'vitest' };
}

async function countAuditEntries(targetId: string): Promise<number> {
  const [result] = await appDatabase('audit_log')
    .where({ target_id: targetId })
    .count<{ count: number }[]>({ count: '*' });
  return result?.count ?? 0;
}

async function insertSessionFor(userId: string): Promise<void> {
  const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
  await dataAccess.repositories.sessions.insertSession({
    tokenHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
    userId,
    idleExpiresAt: inOneHour,
    absoluteExpiresAt: inOneHour,
    ipAddress: null,
    userAgent: null,
  });
}

async function countSessionsFor(userId: string): Promise<number> {
  const [result] = await appDatabase('sessions')
    .where({ user_id: userId })
    .count<{ count: number }[]>({ count: '*' });
  return result?.count ?? 0;
}

beforeAll(async () => {
  await resetTestDatabase(ownerDatabase);
});

afterAll(async () => {
  await Promise.all([ownerDatabase.destroy(), appDatabase.destroy()]);
});

describe('createUser', () => {
  it('stores a hashed password and writes an audit entry', async () => {
    const user = await usersService.createUser(
      { username: uniqueUsername('alice'), role: 'operator', password: PASSWORD },
      SYSTEM_AUDIT_CONTEXT,
    );

    const storedUser = await dataAccess.repositories.users.findUserById(user.id);
    expect(storedUser?.passwordHash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, storedUser?.passwordHash ?? '')).toBe(true);
    expect(await countAuditEntries(user.id)).toBe(1);
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('rejects a username that differs only by case', async () => {
    const username = uniqueUsername('bob');
    await usersService.createUser(
      { username, role: 'viewer', password: PASSWORD },
      SYSTEM_AUDIT_CONTEXT,
    );

    await expect(
      usersService.createUser(
        { username: username.toUpperCase(), role: 'viewer', password: PASSWORD },
        SYSTEM_AUDIT_CONTEXT,
      ),
    ).rejects.toThrow(ConflictError);
  });
});

describe('updateUser admin lockout protection', () => {
  it('stops an admin from demoting themselves', async () => {
    const admin = await usersService.createUser(
      { username: uniqueUsername('admin'), role: 'admin', password: PASSWORD },
      SYSTEM_AUDIT_CONTEXT,
    );

    await expect(
      usersService.updateUser(admin.id, { role: 'viewer' }, contextFor(admin.id)),
    ).rejects.toThrow('You cannot remove your own admin access');
  });

  it('stops anyone from deactivating the last active admin', async () => {
    await ownerDatabase('users').where({ role: 'admin' }).update({ is_active: false });
    const lastAdmin = await usersService.createUser(
      { username: uniqueUsername('last-admin'), role: 'admin', password: PASSWORD },
      SYSTEM_AUDIT_CONTEXT,
    );

    await expect(
      usersService.updateUser(lastAdmin.id, { isActive: false }, SYSTEM_AUDIT_CONTEXT),
    ).rejects.toThrow('At least one active admin must remain');
  });

  it('allows demoting an admin when another active admin remains', async () => {
    const firstAdmin = await usersService.createUser(
      { username: uniqueUsername('admin-a'), role: 'admin', password: PASSWORD },
      SYSTEM_AUDIT_CONTEXT,
    );
    const secondAdmin = await usersService.createUser(
      { username: uniqueUsername('admin-b'), role: 'admin', password: PASSWORD },
      SYSTEM_AUDIT_CONTEXT,
    );

    const demotedUser = await usersService.updateUser(
      secondAdmin.id,
      { role: 'operator' },
      contextFor(firstAdmin.id),
    );

    expect(demotedUser.role).toBe('operator');
  });
});

describe('signing users out', () => {
  it('deletes sessions when a user is deactivated', async () => {
    const user = await usersService.createUser(
      { username: uniqueUsername('carol'), role: 'operator', password: PASSWORD },
      SYSTEM_AUDIT_CONTEXT,
    );
    await insertSessionFor(user.id);

    await usersService.updateUser(user.id, { isActive: false }, SYSTEM_AUDIT_CONTEXT);

    expect(await countSessionsFor(user.id)).toBe(0);
  });

  it('deletes sessions and changes the hash on password reset', async () => {
    const user = await usersService.createUser(
      { username: uniqueUsername('dave'), role: 'operator', password: PASSWORD },
      SYSTEM_AUDIT_CONTEXT,
    );
    await insertSessionFor(user.id);

    await usersService.resetPassword(user.id, 'another-long-password', SYSTEM_AUDIT_CONTEXT);

    const storedUser = await dataAccess.repositories.users.findUserById(user.id);
    expect(await verifyPassword('another-long-password', storedUser?.passwordHash ?? '')).toBe(
      true,
    );
    expect(await countSessionsFor(user.id)).toBe(0);
  });
});
