import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '../../src/Portal/PortalPassword.js';
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
});
