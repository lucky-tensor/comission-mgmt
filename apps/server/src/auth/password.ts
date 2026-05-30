import { pbkdf2 as pbkdf2Callback, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(pbkdf2Callback);

const PASSWORD_SCHEME = 'pbkdf2-sha256';
const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';
const SALT_BYTES = 16;

function encode(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decode(base64url: string): Buffer {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64');
}

/**
 * Hash a password using PBKDF2-SHA256 with a per-password random salt.
 *
 * Format:
 *   pbkdf2-sha256$<iterations>$<salt>$<hash>
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await pbkdf2(
    password,
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_KEYLEN,
    PBKDF2_DIGEST,
  )) as Buffer;
  return [PASSWORD_SCHEME, String(PBKDF2_ITERATIONS), encode(salt), encode(derived)].join('$');
}

/**
 * Verify a password against a PBKDF2-SHA256 hash produced by hashPassword().
 * Returns false for unknown or malformed hash formats.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [scheme, iterationsRaw, saltB64, hashB64] = storedHash.split('$');
  if (scheme !== PASSWORD_SCHEME) return false;

  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  let salt: Buffer;
  let expected: Buffer;

  try {
    salt = decode(saltB64);
    expected = decode(hashB64);
  } catch {
    return false;
  }

  const derived = (await pbkdf2(
    password,
    salt,
    iterations,
    expected.length,
    PBKDF2_DIGEST,
  )) as Buffer;
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
