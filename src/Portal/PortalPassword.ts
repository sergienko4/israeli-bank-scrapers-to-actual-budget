/**
 * Portal password hashing/verification using Node's scrypt. No external deps.
 * Hash format: scrypt$<saltHex>$<hashHex>. Verify is timing-safe.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SALT_BYTES = 16;
const KEY_BYTES = 64;

/**
 * Hashes a plaintext password with a random salt for storage in credentials.json.
 * @param password - Plaintext portal password.
 * @returns Encoded `scrypt$salt$hash` string.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const hash = scryptSync(password, salt, KEY_BYTES).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

/**
 * Verifies a candidate password against a stored scrypt hash.
 * @param password - Candidate plaintext password.
 * @param stored - Previously stored `scrypt$salt$hash` value.
 * @returns True when the candidate matches the stored hash.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, KEY_BYTES);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
