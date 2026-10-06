/**
 * Tests for scrypt password hashing.
 */
import { describe, expect, it } from 'vitest';
import {
  MalformedPasswordHashError,
  hashPassword,
  verifyAgainstDummyHash,
  verifyPassword,
} from './password-hashing.js';

const PASSWORD = 'correct horse battery staple';

describe('hashPassword', () => {
  it('produces a self-describing scrypt hash', async () => {
    expect(await hashPassword(PASSWORD)).toMatch(/^scrypt\$32768\$8\$1\$[^$]+\$[^$]+$/);
  });

  it('salts each hash so equal passwords hash differently', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });
});

describe('verifyPassword', () => {
  it('accepts the right password', async () => {
    expect(await verifyPassword(PASSWORD, await hashPassword(PASSWORD))).toBe(true);
  });

  it('rejects a wrong password', async () => {
    expect(await verifyPassword('wrong password!', await hashPassword(PASSWORD))).toBe(false);
  });

  it.each(['', 'bcrypt$2b$10$abc', 'scrypt$x$8$1$c2FsdA==$aGFzaA==', 'scrypt$1$2$3'])(
    'throws on malformed hash %j',
    async (storedHash) => {
      await expect(verifyPassword(PASSWORD, storedHash)).rejects.toThrow(
        MalformedPasswordHashError,
      );
    },
  );
});

describe('verifyAgainstDummyHash', () => {
  it('completes without throwing', async () => {
    await expect(verifyAgainstDummyHash(PASSWORD)).resolves.toBeUndefined();
  });
});
