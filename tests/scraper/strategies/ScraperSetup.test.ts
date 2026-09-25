/**
 * Unit tests for ScraperSetup — validates OTP retriever attachment
 * logic and edge cases discovered in production (Paybox double OTP bug).
 *
 * Tests cover:
 * 1. OTP not attached to ScraperOptions for credentials-based banks
 * 2. OTP attached to ScraperOptions for OtpHandler banks (beinleumi)
 * 3. Deprecated provider options are never forwarded (scrapers 8.7.0)
 * 4. Each attempt logs in with the long-term token the store vouches for
 */

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';
import { describe, it, expect, vi } from 'vitest';
import buildCredentials from '../../../src/Scraper/CredentialsBuilder.js';
import {
  attachOtpRetriever,
  buildBaseScraperOptions,
  buildTokenCaptureParams,
  initScrape,
} from '../../../src/Scraper/Strategies/Live/ScraperSetup.js';
import type {
  ILiveScrapeDependencies,
  IResolvedLiveOpts,
} from '../../../src/Scraper/Strategies/Live/Types.js';
import type { IBankTokenStore } from '../../../src/Scraper/Tokens/BankTokenStore.js';
import loginFingerprint from '../../../src/Scraper/Tokens/LoginFingerprint.js';
import type { IBankConfig } from '../../../src/Types/Index.js';
import {
  fakeImporterConfig, fakeLoginFingerprint, fakeValidBankConfigFor,
} from '../../helpers/factories.js';
import { fakeToken, makeStore } from '../BankTokenStoreFixture.js';

vi.mock('@sergienko4/israeli-bank-scrapers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sergienko4/israeli-bank-scrapers')>();
  return { ...actual, createScraper: vi.fn(() => ({ scrape: vi.fn() })) };
});

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
  describe('buildTokenCaptureParams', () => {
    /**
     * Builds the options one OneZero attempt resolves to.
     * @param bankConfig - The entry the attempt logs in with.
     * @returns Resolved live options for the entry `oneZero`.
     */
    const oneZeroOpts = (bankConfig: IBankConfig): IResolvedLiveOpts =>
      ({
        companyType: CompanyTypes.OneZero, bankId: 'onezero', accountKey: 'oneZero', bankConfig,
      }) as unknown as IResolvedLiveOpts;

    /** Dependencies whose token store the bundle carries. */
    const deps = { bankTokens: {} } as unknown as ILiveScrapeDependencies;

    it('binds the capture to the fingerprint of the login the entry logs in with', () => {
      const bankConfig = fakeValidBankConfigFor('onezero');
      const expected = loginFingerprint(CompanyTypes.OneZero, bankConfig);

      const params = buildTokenCaptureParams(deps, oneZeroOpts(bankConfig));

      expect(expected.success && params.login).toBe(expected.success && expected.data);
    });

    it('carries no login for an entry with no identity to fingerprint', () => {
      const bankConfig = fakeValidBankConfigFor('onezero', { email: '' });

      const params = buildTokenCaptureParams(deps, oneZeroOpts(bankConfig));

      expect(params.login).toBe('');
    });
  });

  describe('initScrape (the long-term token an attempt sends)', () => {
    /** One bank entry an attempt logs in with. */
    interface IEntry {
      readonly bankId: string;
      readonly companyType: CompanyTypes;
      readonly bankConfig: IBankConfig;
      readonly otpRetriever?: () => Promise<string>;
    }

    /**
     * Builds a logger whose every level is a spy.
     * @returns The spy logger.
     */
    const spyLogger = (): IResolvedLiveOpts['logger'] =>
      ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

    /**
     * Builds the dependencies one attempt reads, over a given token store.
     * @param store - The token store the attempt reads and writes.
     * @returns Dependencies with no Telegram prompter.
     */
    const liveDeps = (store: IBankTokenStore): ILiveScrapeDependencies =>
      ({
        config: fakeImporterConfig(), bankTokens: store, twoFactorPrompter: null,
      }) as unknown as ILiveScrapeDependencies;

    /**
     * Builds the options one attempt resolves to, keyed by the entry's bank id.
     * @param entry - The bank entry, and optionally its OTP retriever.
     * @returns Resolved live options with a spy logger.
     */
    const liveOpts = (entry: IEntry): IResolvedLiveOpts =>
      ({ ...entry, accountKey: entry.bankId, startDate: new Date(), logger: spyLogger() });

    /**
     * Builds a OneZero entry.
     * @param overrides - Bank-config fields to pin.
     * @returns The entry.
     */
    const oneZero = (overrides: Partial<IBankConfig> = {}): IEntry => ({
      bankId: 'onezero', companyType: CompanyTypes.OneZero,
      bankConfig: fakeValidBankConfigFor('onezero', overrides),
    });

    /**
     * Stores a fresh token for the attempt, bound to the login it logs in with.
     * @param deps - Dependencies carrying the store.
     * @param opts - The attempt's options.
     * @returns The stored token.
     */
    const storeOwnToken = (deps: ILiveScrapeDependencies, opts: IResolvedLiveOpts): string => {
      const { storeKey, login } = buildTokenCaptureParams(deps, opts);
      const token = fakeToken();
      deps.bankTokens.write(storeKey, token, login);
      return token;
    };

    /**
     * Builds a store stub that records every read.
     * @returns The stub and its `read` spy.
     */
    const readCountingStore = (): { store: IBankTokenStore; read: ReturnType<typeof vi.fn> } => {
      const read = vi.fn();
      const store = { read, write: vi.fn(), sweepStagedLeftovers: vi.fn() };
      return { store: store as unknown as IBankTokenStore, read };
    };

    it.each([
      ['onezero', CompanyTypes.OneZero],
      ['pepper', CompanyTypes.Pepper],
      ['paybox', CompanyTypes.PayBox],
    ] as const)('logs %s in with the stored token bound to its login, not the configured one', (bankId, companyType) => {
      const bankConfig = fakeValidBankConfigFor(bankId, { otpLongTermToken: fakeToken() });
      const opts = liveOpts({ bankId, companyType, bankConfig });
      const deps = liveDeps(makeStore().store);
      const stored = storeOwnToken(deps, opts);

      const { credentials } = initScrape(deps, opts);

      expect(credentials).toHaveProperty('otpLongTermToken', stored);
    });

    it('sends no token the store binds to another login, even when one is configured', () => {
      const opts = liveOpts(oneZero({ otpLongTermToken: fakeToken() }));
      const deps = liveDeps(makeStore().store);
      const { storeKey } = buildTokenCaptureParams(deps, opts);
      deps.bankTokens.write(storeKey, fakeToken(), fakeLoginFingerprint());

      const { credentials } = initScrape(deps, opts);

      expect(credentials).not.toHaveProperty('otpLongTermToken');
    });

    it('reads the store afresh on every attempt', () => {
      const opts = liveOpts(oneZero());
      const deps = liveDeps(makeStore().store);
      storeOwnToken(deps, opts);
      initScrape(deps, opts);
      const renewed = storeOwnToken(deps, opts);

      const { credentials } = initScrape(deps, opts);

      expect(credentials).toHaveProperty('otpLongTermToken', renewed);
    });

    it('never reads the token store for a browser bank', () => {
      const { store, read } = readCountingStore();
      const bankConfig = fakeValidBankConfigFor('discount');

      initScrape(liveDeps(store), liveOpts({ bankId: 'discount', companyType: CompanyTypes.Discount, bankConfig }));

      expect(read).not.toHaveBeenCalled();
    });

    it('builds a browser bank\'s credentials from its entry as configured, whatever the store holds', () => {
      const seed = fakeToken();
      const bankConfig = fakeValidBankConfigFor('discount', { otpLongTermToken: seed });
      const opts = liveOpts({ bankId: 'discount', companyType: CompanyTypes.Discount, bankConfig });
      const deps = liveDeps(makeStore().store);
      deps.bankTokens.write('onezero:oneZero', seed, fakeLoginFingerprint());

      const { credentials } = initScrape(deps, opts);

      expect(credentials).toEqual(buildCredentials(bankConfig));
    });

    it('warns how to fix an attempt that has no token and cannot ask for an SMS code', () => {
      const opts = liveOpts(oneZero());

      initScrape(liveDeps(makeStore().store), opts);

      expect(opts.logger.warn).toHaveBeenCalledWith(expect.stringContaining('cannot ask for an SMS code'));
    });

    it('does not warn about the fix when the attempt can ask for an SMS code', () => {
      const opts = liveOpts({ ...oneZero(), otpRetriever: async () => '123456' });

      initScrape(liveDeps(makeStore().store), opts);

      expect(opts.logger.warn).not.toHaveBeenCalled();
    });
  });
});
