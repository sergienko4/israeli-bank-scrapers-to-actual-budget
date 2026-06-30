/**
 * Portal password hashing/verification using Node's scrypt. No external deps.
 * Hash format: scrypt$<saltHex>$<hashHex>. Verify is timing-safe.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SALT_BYTES = 16;
const KEY_BYTES = 64;
const ENCODED_HASH = new RegExp(
  String.raw`^scrypt\$[0-9a-f]{${String(SALT_BYTES * 2)}}\$[0-9a-f]{${String(KEY_BYTES * 2)}}$`,
);

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

/**
 * Whether a value is already an encoded scrypt hash rather than a plaintext
 * password, so a freshly typed password — even one that merely starts with
 * "scrypt$" or contains malformed/short hex — is hashed on save and never stored
 * verbatim. Only the exact `scrypt$<32-hex salt>$<128-hex hash>` shape produced
 * by {@link hashPassword} is treated as already encoded.
 * @param value - Candidate stored value.
 * @returns True when the value matches the exact encoded-hash structure.
 */
export function isEncodedHash(value: string): boolean {
  return ENCODED_HASH.test(value);
}
