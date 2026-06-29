import { randomBytes, scryptSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { hashPassword, isEncodedHash, verifyPassword } from '../../src/Portal/PortalPassword.js';
import { TEST_CREDENTIAL } from '../helpers/testCredentials.js';

describe('PortalPassword', () => {
  describe('hashPassword', () => {
    it('returns a scrypt$salt$hash encoded string', () => {
      const stored = hashPassword(TEST_CREDENTIAL);
      const [scheme, salt, hash] = stored.split('$');
      expect(scheme).toBe('scrypt');
      expect(salt).toMatch(/^[0-9a-f]{32}$/);
      expect(hash).toMatch(/^[0-9a-f]{128}$/);
    });

    it('produces a different salt+hash each call', () => {
      expect(hashPassword(TEST_CREDENTIAL)).not.toBe(hashPassword(TEST_CREDENTIAL));
    });
  });

  describe('verifyPassword', () => {
    it('returns true for the correct password', () => {
      const stored = hashPassword(TEST_CREDENTIAL);
      expect(verifyPassword(TEST_CREDENTIAL, stored)).toBe(true);
    });

    it('returns false for the wrong password', () => {
      const stored = hashPassword(TEST_CREDENTIAL);
      expect(verifyPassword('wrong-password', stored)).toBe(false);
    });

    it('returns false when the stored value is malformed', () => {
      expect(verifyPassword(TEST_CREDENTIAL, 'not-a-hash')).toBe(false);
      expect(verifyPassword(TEST_CREDENTIAL, 'sha256$abc$def')).toBe(false);
      expect(verifyPassword(TEST_CREDENTIAL, 'scrypt$$')).toBe(false);
    });

    it('returns false when hash length differs from the candidate', () => {
      expect(verifyPassword(TEST_CREDENTIAL, 'scrypt$abcd$00')).toBe(false);
    });
  });

  describe('isEncodedHash', () => {
    it('is true for a real scrypt$salt$hash value', () => {
      expect(isEncodedHash(hashPassword(TEST_CREDENTIAL))).toBe(true);
    });

    it('is false for plaintext, even when it starts with scrypt$', () => {
      expect(isEncodedHash('my-password')).toBe(false);
      expect(isEncodedHash('scrypt$not-a-real-hash')).toBe(false);
      expect(isEncodedHash('scrypt$abc$XYZ')).toBe(false);
    });
  });

  describe('scripts/hash-portal-password.js format compatibility', () => {
    it('verifies a hash produced exactly like the standalone script', () => {
      const salt = randomBytes(16).toString('hex');
      const hash = scryptSync(TEST_CREDENTIAL, salt, 64).toString('hex');
      const stored = `scrypt$${salt}$${hash}`;
      expect(isEncodedHash(stored)).toBe(true);
      expect(verifyPassword(TEST_CREDENTIAL, stored)).toBe(true);
      expect(verifyPassword('wrong-password', stored)).toBe(false);
    });
  });
});
