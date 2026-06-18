/**
 * Unit tests for ScraperSetup — validates OTP retriever attachment
 * logic and edge cases discovered in production (Paybox double OTP bug).
 *
 * Tests cover:
 * 1. OTP not attached to ScraperOptions for credentials-based banks
 * 2. OTP attached to ScraperOptions for OtpHandler banks (beinleumi)
 */

import { describe, it, expect } from 'vitest';
import { attachOtpRetriever } from '../../../src/Scraper/Strategies/Live/ScraperSetup.js';

describe('ScraperSetup', () => {
  describe('attachOtpRetriever (fix for paybox-double-otp)', () => {
    const mockOtpRetriever = async () => '123456';

    describe('credentials-only banks (OneZero, Pepper, PayBox)', () => {
      const credsBanks = ['OneZero', 'Pepper', 'PayBox'];

      credsBanks.forEach((companyId) => {
        it(`should NOT attach to ScraperOptions for ${companyId}`, () => {
          const opts = {} as any;

          const attached = attachOtpRetriever(opts, mockOtpRetriever, companyId);

          expect(attached).toBe(false);
          expect(opts).not.toHaveProperty('otpCodeRetriever');
        });
      });
    });

    describe('OtpHandler banks (beinleumi)', () => {
      it('should attach to ScraperOptions for beinleumi', () => {
        const opts = {} as any;

        const attached = attachOtpRetriever(opts, mockOtpRetriever, 'beinleumi');

        expect(attached).toBe(true);
        expect(opts).toHaveProperty('otpCodeRetriever', mockOtpRetriever);
      });

      it('should attach to ScraperOptions for any non-credentials-only bank', () => {
        const opts = {} as any;

        const attached = attachOtpRetriever(opts, mockOtpRetriever, 'hapoalim');

        expect(attached).toBe(true);
        expect(opts).toHaveProperty('otpCodeRetriever', mockOtpRetriever);
      });
    });

    describe('edge cases', () => {
      it('returns false when otpRetriever is undefined', () => {
        const opts = {} as any;

        const attached = attachOtpRetriever(opts, undefined, 'hapoalim');

        expect(attached).toBe(false);
        expect(opts).not.toHaveProperty('otpCodeRetriever');
      });

      it('returns false when otpRetriever is undefined even for beinleumi', () => {
        const opts = {} as any;

        const attached = attachOtpRetriever(opts, undefined, 'beinleumi');

        expect(attached).toBe(false);
        expect(opts).not.toHaveProperty('otpCodeRetriever');
      });
    });
  });
});
