import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { CHALLENGE_METHOD, isValidChallenge, verifyChallenge } from '../../src/Portal/Pkce.js';

/** RFC 7636 appendix B reference verifier. */
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

/** RFC 7636 appendix B reference challenge for {@link RFC_VERIFIER}. */
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

/**
 * Derives an S256 challenge the way a client would, so tests can assert
 * against freshly generated pairs as well as the published vector.
 * @param verifier - The verifier to hash.
 * @returns Unpadded base64url SHA-256 digest.
 */
function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

describe('Pkce', () => {
  describe('CHALLENGE_METHOD', () => {
    it('advertises S256 as the only accepted method', () => {
      expect(CHALLENGE_METHOD).toBe('S256');
    });
  });

  describe('isValidChallenge', () => {
    it('accepts a 43-character base64url digest', () => {
      expect(isValidChallenge(RFC_CHALLENGE)).toBe(true);
      expect(isValidChallenge(challengeFor(randomBytes(32).toString('base64url')))).toBe(true);
    });

    it('rejects wrong lengths, padding and non-base64url characters', () => {
      expect(isValidChallenge('')).toBe(false);
      expect(isValidChallenge(RFC_CHALLENGE.slice(0, 42))).toBe(false);
      expect(isValidChallenge(`${RFC_CHALLENGE}A`)).toBe(false);
      expect(isValidChallenge(`${RFC_CHALLENGE.slice(0, 42)}=`)).toBe(false);
      expect(isValidChallenge(`${RFC_CHALLENGE.slice(0, 42)}+`)).toBe(false);
      expect(isValidChallenge(`${RFC_CHALLENGE.slice(0, 42)}/`)).toBe(false);
    });
  });

  describe('verifyChallenge', () => {
    it('accepts the RFC 7636 appendix B vector', () => {
      expect(verifyChallenge(RFC_VERIFIER, RFC_CHALLENGE)).toBe(true);
    });

    it('accepts a freshly generated verifier and challenge pair', () => {
      const verifier = randomBytes(32).toString('base64url');
      expect(verifyChallenge(verifier, challengeFor(verifier))).toBe(true);
    });

    it('rejects a verifier that does not produce the challenge', () => {
      const other = randomBytes(32).toString('base64url');
      expect(verifyChallenge(other, RFC_CHALLENGE)).toBe(false);
    });

    it('rejects the challenge presented as its own verifier', () => {
      expect(verifyChallenge(RFC_CHALLENGE, RFC_CHALLENGE)).toBe(false);
    });

    it('rejects a verifier shorter than 43 or longer than 128 characters', () => {
      const short = 'a'.repeat(42);
      const long = 'a'.repeat(129);
      expect(verifyChallenge(short, challengeFor(short))).toBe(false);
      expect(verifyChallenge(long, challengeFor(long))).toBe(false);
    });

    it('accepts the 43 and 128 character boundaries', () => {
      const min = 'a'.repeat(43);
      const max = 'a'.repeat(128);
      expect(verifyChallenge(min, challengeFor(min))).toBe(true);
      expect(verifyChallenge(max, challengeFor(max))).toBe(true);
    });

    it('rejects a verifier carrying characters outside the unreserved set', () => {
      const verifier = `${'a'.repeat(42)}+`;
      expect(verifyChallenge(verifier, challengeFor(verifier))).toBe(false);
    });

    it('rejects a malformed challenge without hashing the verifier', () => {
      expect(verifyChallenge(RFC_VERIFIER, '')).toBe(false);
      expect(verifyChallenge(RFC_VERIFIER, RFC_CHALLENGE.slice(0, 42))).toBe(false);
      expect(verifyChallenge(RFC_VERIFIER, `${RFC_CHALLENGE}=`)).toBe(false);
    });

    it('rejects a plain-method pairing where the challenge is the verifier', () => {
      const verifier = 'a'.repeat(43);
      expect(verifyChallenge(verifier, verifier)).toBe(false);
    });
  });
});
