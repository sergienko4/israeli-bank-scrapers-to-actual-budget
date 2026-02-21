import { describe, it, expect } from 'vitest';
import { encryptConfig, decryptConfig, isEncryptedConfig } from '../../src/config/ConfigEncryption.js';

const SAMPLE_CONFIG = JSON.stringify({
  actual: { init: { serverURL: 'http://localhost:5006', password: 'secret', dataDir: './data' }, budget: { syncId: 'uuid', password: null } },
  banks: { discount: { id: '123', password: 'bankpass', num: 'ABC' } }
});

describe('ConfigEncryption', () => {
  describe('encryptConfig + decryptConfig', () => {
    it('roundtrip: encrypt then decrypt returns original', () => {
      const encrypted = encryptConfig(SAMPLE_CONFIG, 'testpassword');
      const decrypted = decryptConfig(encrypted, 'testpassword');
      expect(JSON.parse(decrypted)).toEqual(JSON.parse(SAMPLE_CONFIG));
    });

    it('encrypted output contains required fields', () => {
      const encrypted = JSON.parse(encryptConfig(SAMPLE_CONFIG, 'pass'));
      expect(encrypted.encrypted).toBe(true);
      expect(encrypted.version).toBe(1);
      expect(encrypted.salt).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.tag).toBeDefined();
      expect(encrypted.ciphertext).toBeDefined();
    });

    it('two encryptions produce different output (random salt+IV)', () => {
      const a = encryptConfig(SAMPLE_CONFIG, 'same');
      const b = encryptConfig(SAMPLE_CONFIG, 'same');
      expect(a).not.toBe(b);
    });

    it('wrong password throws error', () => {
      const encrypted = encryptConfig(SAMPLE_CONFIG, 'correct');
      expect(() => decryptConfig(encrypted, 'wrong')).toThrow('Decryption failed');
    });

    it('tampered ciphertext throws error', () => {
      const data = JSON.parse(encryptConfig(SAMPLE_CONFIG, 'pass'));
      data.ciphertext = data.ciphertext.replace(/A/g, 'B');
      expect(() => decryptConfig(JSON.stringify(data), 'pass')).toThrow('Decryption failed');
    });

    it('empty password throws on encrypt', () => {
      expect(() => encryptConfig(SAMPLE_CONFIG, '')).toThrow('empty');
    });

    it('empty password throws on decrypt', () => {
      const encrypted = encryptConfig(SAMPLE_CONFIG, 'pass');
      expect(() => decryptConfig(encrypted, '')).toThrow('CONFIG_PASSWORD');
    });

    it('handles large config', () => {
      const large = JSON.stringify({ data: 'x'.repeat(100_000) });
      const encrypted = encryptConfig(large, 'pass');
      const decrypted = decryptConfig(encrypted, 'pass');
      expect(JSON.parse(decrypted)).toEqual(JSON.parse(large));
    });

    it('handles unicode/Hebrew content', () => {
      const hebrew = JSON.stringify({ payee: 'שופרסל דיזנגוף', amount: 100 });
      const encrypted = encryptConfig(hebrew, 'pass');
      const decrypted = decryptConfig(encrypted, 'pass');
      expect(JSON.parse(decrypted)).toEqual(JSON.parse(hebrew));
    });
  });

  describe('isEncryptedConfig', () => {
    it('returns true for encrypted config', () => {
      const data = JSON.parse(encryptConfig(SAMPLE_CONFIG, 'pass'));
      expect(isEncryptedConfig(data)).toBe(true);
    });

    it('returns false for plain config', () => {
      expect(isEncryptedConfig(JSON.parse(SAMPLE_CONFIG))).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isEncryptedConfig(null)).toBe(false);
      expect(isEncryptedConfig(undefined)).toBe(false);
    });
  });
});
