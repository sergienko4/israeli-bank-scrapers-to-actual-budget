/**
 * A one-way digest of a long-term token, so a refusal can be remembered
 * without keeping the token.
 *
 * <p>The input starts with a fixed label and version, so the digest is never a
 * plain SHA-256 of the token and the recipe can change later without matching
 * old digests by accident. Surrounding whitespace is ignored because the
 * resolver sends the trimmed token.
 */

import { createHash } from 'node:crypto';

/** Labels and versions the digest input. */
const DIGEST_DOMAIN = 'refused-long-term-token:v1\0';

/** A token digest: SHA-256 as 64 lowercase hex characters. */
const TOKEN_DIGEST = /^[\da-f]{64}$/u;

/**
 * Digests a long-term token.
 * @param token - The token, as configured or stored.
 * @returns SHA-256 of the label and the trimmed token, as 64 lowercase hex characters.
 */
export default function tokenDigest(token: string): string {
  const input = `${DIGEST_DOMAIN}${token.trim()}`;
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Checks whether a value has the shape of a token digest.
 * @param value - Any value, such as one read from a file.
 * @returns True for 64 lowercase hex characters.
 */
export function isTokenDigest(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_DIGEST.test(value);
}
