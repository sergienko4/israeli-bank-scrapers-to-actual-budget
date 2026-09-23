/**
 * Unit tests for ScraperSetup — validates OTP retriever attachment
 * logic and edge cases discovered in production (Paybox double OTP bug).
 *
 * Tests cover:
 * 1. OTP not attached to ScraperOptions for credentials-based banks
 * 2. OTP attached to ScraperOptions for OtpHandler banks (beinleumi)
 * 3. Deprecated provider options are never forwarded (scrapers 8.7.0)
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';
import { describe, it, expect, vi } from 'vitest';
import {
  attachOtpRetriever,
  buildBaseScraperOptions,
  buildScraperOptions,
  buildTokenCaptureParams,
} from '../../../src/Scraper/Strategies/Live/ScraperSetup.js';
import BankTokenStore from '../../../src/Scraper/Tokens/BankTokenStore.js';
import type { IBankTokenStore } from '../../../src/Scraper/Tokens/BankTokenStore.js';
import { withWarmToken } from '../../../src/Scraper/Tokens/WarmTokenResolver.js';
import { succeed } from '../../../src/Types/Index.js';
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
    /**
     * Builds the minimal dependency stub the option builder reads.
     * @param level - Optional log level; omitting it leaves `logConfig` undefined.
     * @returns A partial dependency object cast to the full strategy interface.
     */
    const makeDeps = (level?: string): ILiveScrapeDependencies =>
      ({
        config: { logConfig: level === undefined ? undefined : { level } },
      }) as unknown as ILiveScrapeDependencies;

    /**
     * Builds scrape options whose bank config still carries both deprecated keys.
     * @returns Resolved live options shared by every case in this block.
     */
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

  /**
   * Provider 8.7.2 redacts the long-term token from its own logs, so the
   * only way to obtain it is the completion callback. Without this wiring an
   * API-direct bank pays for an SMS on every single run.
   */
  describe('buildScraperOptions (long-term token capture)', () => {
    const writes: { bankId: string; token: string }[] = [];
    const bankTokens: IBankTokenStore = {
      read: (): string => '',
      write: (bankId: string, token: string) => {
        writes.push({ bankId, token });
        return succeed({ written: true });
      },
    };

    /**
     * Builds the minimal dependency stub carrying a capturing token store.
     * @returns A partial dependency object cast to the full strategy interface.
     */
    const makeDeps = (): ILiveScrapeDependencies =>
      ({ config: {}, bankTokens }) as unknown as ILiveScrapeDependencies;

    /**
     * Builds resolved live options for one bank.
     * @param companyType - Provider company id under test.
     * @returns Resolved live options for that bank.
     */
    const makeOpts = (companyType: CompanyTypes): IResolvedLiveOpts =>
      ({
        bankId: companyType, companyType,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        bankConfig: {}, logger: { info: vi.fn(), warn: vi.fn() },
      }) as unknown as IResolvedLiveOpts;

    it('attaches the capture callback for oneZero', () => {
      const options = buildScraperOptions(makeDeps(), makeOpts(CompanyTypes.OneZero), undefined);

      expect(typeof options.onAuthFlowComplete).toBe('function');
    });

    it('persists the token the provider hands back through the callback', async () => {
      writes.length = 0;
      const options = buildScraperOptions(makeDeps(), makeOpts(CompanyTypes.PayBox), undefined);

      await options.onAuthFlowComplete?.({ longTermToken: 'id-token', bearer: 'session' });

      expect(writes).toEqual([{ bankId: 'payBox', token: 'id-token' }]);
    });

    it('leaves browser banks without a callback they can never fire', () => {
      const options = buildScraperOptions(makeDeps(), makeOpts(CompanyTypes.Hapoalim), undefined);

      expect(options).not.toHaveProperty('onAuthFlowComplete');
    });
  });

  /**
   * Two config entries can resolve to one bankId, because the registry matches
   * aliases case-insensitively and `onezero` lists both `oneZero` and
   * `onezero`. Sharing one token slot between two real accounts would make
   * each run replay the other account's token, fail the warm start, and
   * re-mint — revoking the other account's token on every single run.
   */
  describe('per-account token isolation', () => {
    /**
     * Builds resolved live options for one configured account of a bank.
     * @param accountKey - Config entry name the scrape came from.
     * @returns Resolved live options carrying that account key.
     */
    const makeAccountOpts = (accountKey: string): IResolvedLiveOpts =>
      ({
        bankId: 'onezero', companyType: CompanyTypes.OneZero, accountKey,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        bankConfig: {}, logger: { info: vi.fn(), warn: vi.fn() },
      }) as unknown as IResolvedLiveOpts;

    it('does not replay one account token for a second account of the same bank', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'scraper-setup-tokens-'));
      const store = new BankTokenStore(join(dir, 'bank-tokens.json'));
      const deps = ({ config: {}, bankTokens: store }) as unknown as ILiveScrapeDependencies;
      const first = makeAccountOpts('oneZero');
      const options = buildScraperOptions(deps, first, undefined);

      await options.onAuthFlowComplete?.({ longTermToken: 'first-token', bearer: 'session' });
      const secondParams = buildTokenCaptureParams(deps, makeAccountOpts('onezero'));
      const replayed = withWarmToken({}, secondParams);

      rmSync(dir, { recursive: true, force: true });
      expect(replayed.otpLongTermToken).toBeUndefined();
    });

    it('replays the token back to the same account that captured it', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'scraper-setup-tokens-'));
      const store = new BankTokenStore(join(dir, 'bank-tokens.json'));
      const deps = ({ config: {}, bankTokens: store }) as unknown as ILiveScrapeDependencies;
      const options = buildScraperOptions(deps, makeAccountOpts('oneZero'), undefined);

      await options.onAuthFlowComplete?.({ longTermToken: 'first-token', bearer: 'session' });
      const sameParams = buildTokenCaptureParams(deps, makeAccountOpts('oneZero'));
      const replayed = withWarmToken({}, sameParams);

      rmSync(dir, { recursive: true, force: true });
      expect(replayed.otpLongTermToken).toBe('first-token');
    });
  });
});
