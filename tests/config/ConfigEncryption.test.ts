import { describe, it, expect, afterEach } from 'vitest';
import { encryptConfig, decryptConfig, isEncryptedConfig, getEncryptionPassword } from '../../src/Config/ConfigEncryption.js';
import { TEST_CREDENTIAL, TEST_ENCRYPTION_KEY } from '../helpers/testCredentials.js';

const SAMPLE_CONFIG = JSON.stringify({
  actual: { init: { serverURL: 'http://localhost:5006', password: TEST_CREDENTIAL, dataDir: './data' }, budget: { syncId: 'uuid', password: null } },
  banks: { discount: { id: '123', password: TEST_CREDENTIAL, num: 'ABC' } }
});

describe('ConfigEncryption', () => {
  describe('encryptConfig + decryptConfig', () => {
    it('roundtrip: encrypt then decrypt returns original', () => {
      const encrypted = encryptConfig(SAMPLE_CONFIG, TEST_ENCRYPTION_KEY);
      const decrypted = decryptConfig(encrypted, TEST_ENCRYPTION_KEY);
      expect(JSON.parse(decrypted)).toEqual(JSON.parse(SAMPLE_CONFIG));
    });

    it('encrypted output contains required fields', () => {
      const encrypted = JSON.parse(encryptConfig(SAMPLE_CONFIG, TEST_ENCRYPTION_KEY));
      expect(encrypted.encrypted).toBe(true);
      expect(encrypted.version).toBe(1);
      expect(encrypted.salt).toBeDefined();
      expect(encrypted.initVector).toBeDefined();
      expect(encrypted.tag).toBeDefined();
      expect(encrypted.ciphertext).toBeDefined();
    });

    it('two encryptions produce different output (random salt+IV)', () => {
      const a = encryptConfig(SAMPLE_CONFIG, TEST_ENCRYPTION_KEY);
      const b = encryptConfig(SAMPLE_CONFIG, TEST_ENCRYPTION_KEY);
      expect(a).not.toBe(b);
    });

    it('wrong password throws error', () => {
      const encrypted = encryptConfig(SAMPLE_CONFIG, TEST_ENCRYPTION_KEY);
      expect(() => decryptConfig(encrypted, 'wrong-key')).toThrow('Decryption failed');
    });

    it('tampered ciphertext throws error', () => {
      const data = JSON.parse(encryptConfig(SAMPLE_CONFIG, TEST_ENCRYPTION_KEY));
      const buf = Buffer.from(data.ciphertext, 'base64');
      buf[0] ^= 0xff;
      data.ciphertext = buf.toString('base64');
      expect(() => decryptConfig(JSON.stringify(data), TEST_ENCRYPTION_KEY)).toThrow('Decryption failed');
    });

    it('empty password throws on encrypt', () => {
      expect(() => encryptConfig(SAMPLE_CONFIG, '')).toThrow('empty');
    });

    it('empty password throws on decrypt', () => {
      const encrypted = encryptConfig(SAMPLE_CONFIG, TEST_ENCRYPTION_KEY);
      expect(() => decryptConfig(encrypted, '')).toThrow('CREDENTIALS_ENCRYPTION_PASSWORD');
    });

    it('handles large config', () => {
      const large = JSON.stringify({ data: 'x'.repeat(100_000) });
      const encrypted = encryptConfig(large, TEST_ENCRYPTION_KEY);
      const decrypted = decryptConfig(encrypted, TEST_ENCRYPTION_KEY);
      expect(JSON.parse(decrypted)).toEqual(JSON.parse(large));
    });

    it('handles unicode/Hebrew content', () => {
      const hebrew = JSON.stringify({ payee: 'שופרסל דיזנגוף', amount: 100 });
      const encrypted = encryptConfig(hebrew, TEST_ENCRYPTION_KEY);
      const decrypted = decryptConfig(encrypted, TEST_ENCRYPTION_KEY);
      expect(JSON.parse(decrypted)).toEqual(JSON.parse(hebrew));
    });
  });

  describe('getEncryptionPassword', () => {
    afterEach(() => {
      delete process.env.CREDENTIALS_ENCRYPTION_PASSWORD;
      delete process.env.CONFIG_PASSWORD;
    });

    it('returns CREDENTIALS_ENCRYPTION_PASSWORD when set', () => {
      process.env.CREDENTIALS_ENCRYPTION_PASSWORD = 'primary-pass';
      expect(getEncryptionPassword()).toBe('primary-pass');
    });

    it('falls back to CONFIG_PASSWORD when CREDENTIALS_ENCRYPTION_PASSWORD is not set', () => {
      delete process.env.CREDENTIALS_ENCRYPTION_PASSWORD;
      process.env.CONFIG_PASSWORD = 'fallback-pass';
      expect(getEncryptionPassword()).toBe('fallback-pass');
    });

    it('returns empty string when neither env var is set', () => {
      delete process.env.CREDENTIALS_ENCRYPTION_PASSWORD;
      delete process.env.CONFIG_PASSWORD;
      expect(getEncryptionPassword()).toBe('');
    });
  });

  describe('isEncryptedConfig', () => {
    it('returns true for encrypted config', () => {
      const data = JSON.parse(encryptConfig(SAMPLE_CONFIG, TEST_ENCRYPTION_KEY));
      expect(isEncryptedConfig(data)).toBe(true);
    });

    it('returns false for plain config', () => {
      expect(isEncryptedConfig(JSON.parse(SAMPLE_CONFIG))).toBe(false);
    });

    it('returns false for empty object', () => {
      expect(isEncryptedConfig({})).toBe(false);
      expect(isEncryptedConfig({ encrypted: false })).toBe(false);
    });
  });
});
