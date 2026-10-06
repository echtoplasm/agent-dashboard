/**
 * Password hashing with Node's built-in scrypt.
 *
 * scrypt is memory-hard, so guessing passwords on GPUs is expensive, and it
 * ships with Node, so no native dependency is needed. Hashes are stored with
 * their parameters (`scrypt$N$r$p$salt$hash`) so the cost can be raised later
 * without breaking existing passwords. See D-016 in docs/decisions.md.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const HASH_SCHEME = 'scrypt';
const HASH_FIELD_SEPARATOR = '$';
const HASH_FIELD_COUNT = 6;
const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 64;

/** scrypt cost parameters: CPU/memory cost N, block size r, parallelism p. */
interface ScryptCost {
  N: number;
  r: number;
  p: number;
}

/** Cost parameters for new hashes: about 32 MiB of memory per hash (128 × N × r bytes). */
const DEFAULT_COST: ScryptCost = { N: 2 ** 15, r: 8, p: 1 };

/** Upper bound Node may allocate, with headroom above the 32 MiB the cost needs. */
const MAX_SCRYPT_MEMORY_BYTES = 64 * 1024 * 1024;

/** Thrown when a stored hash is not in the expected format. */
export class MalformedPasswordHashError extends Error {
  constructor() {
    super('Stored password hash is malformed');
    this.name = 'MalformedPasswordHashError';
  }
}

function deriveKey(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      DERIVED_KEY_BYTES,
      { ...cost, maxmem: MAX_SCRYPT_MEMORY_BYTES },
      (error, derivedKey) => {
        if (error) {
          reject(error);
        } else {
          resolve(derivedKey);
        }
      },
    );
  });
}

/**
 * Hashes a password with a fresh random salt.
 *
 * @param password - The plaintext password.
 * @returns A self-describing hash string safe to store.
 *
 * @example
 * ```ts
 * await hashPassword('correct horse battery staple');
 * // 'scrypt$32768$8$1$<salt>$<hash>'
 * ```
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = await deriveKey(password, salt, DEFAULT_COST);
  return [
    HASH_SCHEME,
    DEFAULT_COST.N,
    DEFAULT_COST.r,
    DEFAULT_COST.p,
    salt.toString('base64'),
    derivedKey.toString('base64'),
  ].join(HASH_FIELD_SEPARATOR);
}

/**
 * Checks a password against a stored hash in constant time.
 *
 * @param password - The plaintext password to check.
 * @param storedHash - A hash produced by `hashPassword`.
 * @returns `true` if the password matches.
 * @throws {MalformedPasswordHashError} If `storedHash` is not a recognised format.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const fields = storedHash.split(HASH_FIELD_SEPARATOR);
  const [scheme, costN, costR, costP, saltBase64, hashBase64] = fields;
  if (fields.length !== HASH_FIELD_COUNT || scheme !== HASH_SCHEME) {
    throw new MalformedPasswordHashError();
  }
  const cost = { N: Number(costN), r: Number(costR), p: Number(costP) };
  if (!Object.values(cost).every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new MalformedPasswordHashError();
  }

  const expectedKey = Buffer.from(hashBase64 ?? '', 'base64');
  const derivedKey = await deriveKey(password, Buffer.from(saltBase64 ?? '', 'base64'), cost);
  return expectedKey.length === derivedKey.length && timingSafeEqual(expectedKey, derivedKey);
}

let dummyHashPromise: Promise<string> | undefined;

/**
 * Runs a full password verification against a throwaway hash.
 *
 * Login calls this when the username doesn't exist, so a failed login takes
 * about as long whether or not the account exists. Response time then can't
 * be used to discover valid usernames.
 *
 * @param password - The submitted password.
 */
export async function verifyAgainstDummyHash(password: string): Promise<void> {
  dummyHashPromise ??= hashPassword(randomBytes(SALT_BYTES).toString('base64'));
  await verifyPassword(password, await dummyHashPromise);
}
