import { describe, it, expect, vi } from 'vitest';
import { buildCredentials } from '../../src/Scraper/CredentialsBuilder.js';
import type { BankConfig } from '../../src/Types/index.js';

const idBank = { id: 'user123', password: 'pass' } as BankConfig;
const emailBank = {
  email: 'user@example.com', password: 'pass', phoneNumber: '+972501234567'
} as BankConfig;

describe('buildCredentials', () => {
  describe('with otpRetriever', () => {
    it('includes otpCodeRetriever for id-based bank (beinleumi / OtpHandler flow)', () => {
      const retriever = vi.fn().mockResolvedValue('123456');
      const creds = buildCredentials(idBank, retriever) as Record<string, unknown>;
      expect(creds.otpCodeRetriever).toBe(retriever);
      expect(creds.id).toBe('user123');
    });

    it('includes otpCodeRetriever for email-based bank (oneZero credentials flow)', () => {
      const retriever = vi.fn().mockResolvedValue('654321');
      const creds = buildCredentials(emailBank, retriever) as Record<string, unknown>;
      expect(creds.otpCodeRetriever).toBe(retriever);
      expect(creds.email).toBe('user@example.com');
      expect(creds.phoneNumber).toBe('+972501234567');
    });
  });

  describe('without otpRetriever', () => {
    it('omits otpCodeRetriever for id-based bank', () => {
      const creds = buildCredentials(idBank) as Record<string, unknown>;
      expect(creds.otpCodeRetriever).toBeUndefined();
      expect(creds.id).toBe('user123');
    });

    it('omits otpCodeRetriever for email-based bank', () => {
      const creds = buildCredentials(emailBank) as Record<string, unknown>;
      expect(creds.otpCodeRetriever).toBeUndefined();
    });
  });

  describe('otpLongTermToken', () => {
    it('returns email+password+token credentials', () => {
      const config = { ...emailBank, otpLongTermToken: 'tok123' } as BankConfig;
      const creds = buildCredentials(config) as Record<string, unknown>;
      expect(creds.otpLongTermToken).toBe('tok123');
      expect(creds.email).toBe('user@example.com');
      expect(creds.id).toBeUndefined();
    });

    it('takes precedence over otpRetriever — token path skips retriever', () => {
      const retriever = vi.fn();
      const config = { ...emailBank, otpLongTermToken: 'tok123' } as BankConfig;
      const creds = buildCredentials(config, retriever) as Record<string, unknown>;
      expect(creds.otpLongTermToken).toBe('tok123');
      expect(creds.otpCodeRetriever).toBeUndefined();
    });
  });
});
