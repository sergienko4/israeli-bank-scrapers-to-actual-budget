import { beforeEach, describe, it, expect, vi } from 'vitest';

import buildCredentials from '../../src/Scraper/CredentialsBuilder.js';
import { toProviderPhone } from '../../src/Utils/PhoneNumberNormaliser.js';
import type { IBankConfig } from '../../src/Types/Index.js';
import { fakeBankConfig } from '../helpers/factories.js';
import { TEST_CREDENTIAL } from '../helpers/testCredentials.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  getLogBuffer: vi.fn(),
}));

const idBank = { id: 'user123', password: TEST_CREDENTIAL } as IBankConfig;
const emailBank = {
  email: 'user@example.com', password: TEST_CREDENTIAL, phoneNumber: '+972501234567'
} as IBankConfig;

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
      expect(creds.phoneNumber).toBe('972501234567');
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
      const config = { ...emailBank, otpLongTermToken: 'tok123' } as IBankConfig;
      const creds = buildCredentials(config) as Record<string, unknown>;
      expect(creds.otpLongTermToken).toBe('tok123');
      expect(creds.email).toBe('user@example.com');
      expect(creds.phoneNumber).toBe('972501234567');
      expect(creds.id).toBeUndefined();
    });

    it('attaches otpCodeRetriever in warm-start branch so cold-fallback works', () => {
      const retriever = vi.fn();
      const config = { ...emailBank, otpLongTermToken: 'tok123' } as IBankConfig;
      const creds = buildCredentials(config, retriever) as Record<string, unknown>;
      expect(creds.otpLongTermToken).toBe('tok123');
      expect(creds.otpCodeRetriever).toBe(retriever);
    });

    it('defaults email to empty string when email is undefined', () => {
      const config = { password: TEST_CREDENTIAL, otpLongTermToken: 'tok456' } as IBankConfig;
      const creds = buildCredentials(config) as Record<string, unknown>;
      expect(creds.otpLongTermToken).toBe('tok456');
      expect(creds.email).toBe('');
      expect(creds.password).toBe(TEST_CREDENTIAL);
      expect(creds.phoneNumber).toBeUndefined();
    });

    it('defaults both email and password to empty strings when both are undefined', () => {
      const config = { otpLongTermToken: 'tok789' } as IBankConfig;
      const creds = buildCredentials(config) as Record<string, unknown>;
      expect(creds.otpLongTermToken).toBe('tok789');
      expect(creds.email).toBe('');
      expect(creds.password).toBe('');
      expect(creds.phoneNumber).toBeUndefined();
    });

    it('preserves phoneNumber for payBox (phoneNumber-only API bank) with token', () => {
      const config = {
        phoneNumber: '+972500000000', otpLongTermToken: 'paybox-tok'
      } as IBankConfig;
      const creds = buildCredentials(config) as Record<string, unknown>;
      expect(creds.otpLongTermToken).toBe('paybox-tok');
      expect(creds.phoneNumber).toBe('972500000000');
      expect(creds.password).toBe('');
    });

    it('preserves phoneNumber+password for pepper (phoneNumber-based API bank) with token', () => {
      const config = {
        phoneNumber: '+972500000001', password: TEST_CREDENTIAL,
        otpLongTermToken: 'pepper-tok'
      } as IBankConfig;
      const creds = buildCredentials(config) as Record<string, unknown>;
      expect(creds.otpLongTermToken).toBe('pepper-tok');
      expect(creds.phoneNumber).toBe('972500000001');
      expect(creds.password).toBe(TEST_CREDENTIAL);
    });
  });

  describe('phoneNumber normalisation', () => {
    it('TC-CREDS-001 — coerces +972 paybox phone to canonical', () => {
      const config = { phoneNumber: '+972542155100' } as IBankConfig;
      const creds = buildCredentials(config) as Record<string, unknown>;
      expect(creds.phoneNumber).toBe('972542155100');
    });

    it('TC-CREDS-002 — coerces dashed pepper phone + keeps password', () => {
      const config = {
        phoneNumber: '972-52-1234567', password: TEST_CREDENTIAL
      } as IBankConfig;
      const creds = buildCredentials(config) as Record<string, unknown>;
      expect(creds.phoneNumber).toBe('972521234567');
      expect(creds.password).toBe(TEST_CREDENTIAL);
    });

    it('TC-CREDS-003 — leaves config without phoneNumber untouched', () => {
      const creds = buildCredentials(idBank) as Record<string, unknown>;
      expect(creds.phoneNumber).toBeUndefined();
    });

    it('TC-CREDS-004 — forwards stripped candidate on normalisation failure', () => {
      const config = { id: 'paybox-x', phoneNumber: 'bogus' } as IBankConfig;
      const creds = buildCredentials(config) as Record<string, unknown>;
      expect(creds.phoneNumber).toBe('bogus');
    });

    it('TC-CREDS-004b — strips +/dashes even on normalisation failure', () => {
      const config = { id: 'paybox-x', phoneNumber: '+972-extra-99' } as IBankConfig;
      const creds = buildCredentials(config) as Record<string, unknown>;
      expect(creds.phoneNumber).toBe('972extra99');
    });

    it('coerces leading-zero Israeli local form to canonical', () => {
      const config = { phoneNumber: '0521234567' } as IBankConfig;
      const creds = buildCredentials(config) as Record<string, unknown>;
      expect(creds.phoneNumber).toBe('972521234567');
    });
  });

  describe('phone sent to the provider', () => {
    const phones = ['+972527654321', '052-765-4321', '972 52 765 4321', '+44 7700-900123'];

    it.each(phones)('sends %s in the form toProviderPhone gives, with or without a token', (raw) => {
      const withToken = buildCredentials(fakeBankConfig({ phoneNumber: raw, otpLongTermToken: 'lt' }));
      const withoutToken = buildCredentials(fakeBankConfig({ phoneNumber: raw }));

      expect((withToken as Record<string, unknown>).phoneNumber).toBe(toProviderPhone(raw));
      expect((withoutToken as Record<string, unknown>).phoneNumber).toBe(toProviderPhone(raw));
    });
  });

  describe('phone normalisation warning', () => {
    beforeEach(() => {
      mockLogger.warn.mockClear();
    });

    it('warns once, with the phone masked, when the phone is not an Israeli mobile', () => {
      const { warn } = mockLogger;

      buildCredentials(fakeBankConfig({ id: 'pepper', phoneNumber: '+44 7700-900123' }));

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('Phone normalisation failed for pepper (<masked>)');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('7700');
    });

    it('does not warn for an Israeli mobile', () => {
      const { warn } = mockLogger;

      buildCredentials(fakeBankConfig({ phoneNumber: '052-765-4321' }));

      expect(warn).not.toHaveBeenCalled();
    });
  });
});
