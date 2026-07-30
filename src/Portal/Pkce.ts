/**
 * PKCE verification for the mobile app authorization flow. Only the `S256`
 * challenge method is supported: `plain` gives a stolen authorization code no
 * protection at all, so callers reject it before reaching this module.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/** The only `code_challenge_method` this portal accepts. */
export const CHALLENGE_METHOD = 'S256';

/** Shape of a legal `code_verifier` per RFC 7636 section 4.1. */
const VERIFIER = /^[\w.~-]{43,128}$/;

/** Shape of an unpadded base64url SHA-256 digest. */
const CHALLENGE = /^[\w-]{43}$/;

/**
 * Whether a value is a well-formed `S256` code challenge. Routes call this to
 * reject a malformed parameter before any authorization state is created.
 * @param challenge - Candidate `code_challenge` request parameter.
 * @returns True when the value is 43 base64url characters.
 */
export function isValidChallenge(challenge: string): boolean {
  return CHALLENGE.test(challenge);
}

/**
 * Derives the `S256` challenge for a verifier.
 * @param verifier - A syntactically valid `code_verifier`.
 * @returns Unpadded base64url SHA-256 digest of the verifier's ASCII bytes.
 */
function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/**
 * Verifies a `code_verifier` against the challenge captured when the
 * authorization code was minted. Malformed input is rejected before hashing so
 * the endpoint cannot be used as a hashing oracle, and the comparison is
 * timing-safe.
 * @param verifier - The `code_verifier` presented at the token endpoint.
 * @param challenge - The `code_challenge` bound to the authorization code.
 * @returns True when the verifier produces exactly that challenge.
 */
export function verifyChallenge(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier) || !CHALLENGE.test(challenge)) return false;
  const digest = challengeOf(verifier);
  const expected = Buffer.from(digest);
  const actual = Buffer.from(challenge);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
