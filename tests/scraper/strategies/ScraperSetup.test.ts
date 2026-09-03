/**
 * Unit tests for ScraperSetup — validates OTP retriever attachment
 * logic and edge cases discovered in production (Paybox double OTP bug).
 *
 * Tests cover:
 * 1. OTP not attached to ScraperOptions for credentials-based banks
 * 2. OTP attached to ScraperOptions for OtpHandler banks (beinleumi)
 * 3. Deprecated provider options are never forwarded (scrapers 8.7.0)
 */

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';
import { describe, it, expect } from 'vitest';
import {
  attachOtpRetriever,
  buildBaseScraperOptions,
} from '../../../src/Scraper/Strategies/Live/ScraperSetup.js';
import type {
  ILiveScrapeDependencies,
  IResolvedLiveOpts,
} from '../../../src/Scraper/Strategies/Live/Types.js';

describe('ScraperSetup', () => {
  describe('attachOtpRetriever (fix for paybox-double-otp)', () => {
    const mockOtpRetriever = async () => '123456';

    describe('credentials-only banks (OneZero, Pepper, PayBox)', () => {
      const credsBanks = [CompanyTypes.OneZero, CompanyTypes.Pepper, CompanyTypes.PayBox];

      credsBanks.forEach((companyId) => {
        it(`should NOT attach to ScraperOptions for ${companyId}`, () => {
          const opts = {} as any;

          const attached = attachOtpRetriever(opts, mockOtpRetriever, companyId);

          expect(attached).toBe(false);
          expect(opts).not.toHaveProperty('otpCodeRetriever');
        });
      });
    });

    /**
     * Regression guard for the casing defect this suite once masked: the
     * CompanyTypes values are camelCase (`payBox`), so a hand-written
     * PascalCase literal falls through and the guard silently stops working.
     */
    it('treats a PascalCase literal as an unknown bank', () => {
      const opts = {} as any;

      const attached = attachOtpRetriever(opts, mockOtpRetriever, 'PayBox');

      expect(attached).toBe(true);
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

  /**
   * Regression guard for the scrapers 8.7.0 upgrade.
   *
   * 8.7.0 marked `navigationRetryCount` and `storeFailureScreenShotPath`
   * as deprecated: the Pipeline ignores both, and only the sunset legacy
   * scrapers ever read them. We stopped forwarding them entirely, so these
   * tests fail the moment someone reintroduces either key — including via
   * a bank config that still carries the old settings.
   */
  describe('buildBaseScraperOptions (provider 8.7.0 deprecations)', () => {
    const makeDeps = (level?: string): ILiveScrapeDependencies =>
      ({
        config: { logConfig: level === undefined ? undefined : { level } },
      }) as unknown as ILiveScrapeDependencies;

    const makeOpts = (): IResolvedLiveOpts =>
      ({
        companyType: CompanyTypes.Mizrahi,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        bankConfig: {
          timeout: 45_000,
          navigationRetryCount: 3,
          failureScreenshotPath: '/tmp/shots',
        },
      }) as unknown as IResolvedLiveOpts;

    it('does not forward navigationRetryCount even when the bank config sets it', () => {
      const options = buildBaseScraperOptions(makeDeps(), makeOpts());

      expect(options).not.toHaveProperty('navigationRetryCount');
    });

    it('does not attach storeFailureScreenShotPath at debug level', () => {
      const options = buildBaseScraperOptions(makeDeps('debug'), makeOpts());

      expect(options).not.toHaveProperty('storeFailureScreenShotPath');
    });

    it('does not attach storeFailureScreenShotPath at trace level', () => {
      const options = buildBaseScraperOptions(makeDeps('trace'), makeOpts());

      expect(options).not.toHaveProperty('storeFailureScreenShotPath');
    });

    it('still forwards the options the provider does support', () => {
      const options = buildBaseScraperOptions(makeDeps(), makeOpts());

      expect(options.companyId).toBe(CompanyTypes.Mizrahi);
      expect(options.defaultTimeout).toBe(45_000);
      expect(options.startDate).toEqual(new Date('2024-01-01T00:00:00.000Z'));
    });

    it('falls back to the default timeout when the bank config omits it', () => {
      const opts = { ...makeOpts(), bankConfig: {} } as unknown as IResolvedLiveOpts;

      const options = buildBaseScraperOptions(makeDeps(), opts);

      expect(options.defaultTimeout).toBe(60_000);
    });
  });
});
