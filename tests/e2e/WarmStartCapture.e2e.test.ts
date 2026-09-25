/**
 * E2E: capturing a long-term token through the real import assembly.
 *
 * <p>The provider redacts the durable token from its own logs, so the only
 * way an operator ever gets it is if the importer captures it and writes it
 * to disk. This suite drives the shipped composition — `buildScrapeStrategy`
 * reading `BANK_TOKENS_PATH`, `BankScraper` resolving the config entry,
 * the live strategy, and `BankTokenStore` on a real temp directory — and
 * asserts what the operator relies on: the file is there, owner-only, and
 * the run's transactions never depend on it.
 *
 * <p>`createScraper` is substituted, because no real bank can be called from
 * a test; the fake fires `onAuthFlowComplete` mid-scrape exactly as the
 * provider does, before the result exists. The retry and timeout policies are
 * the shipped classes with the shipped single-attempt settings, minus the
 * shutdown handler, which would attach process signal listeners per case.
 * The 2FA prompter and notifier are not reached by an API-direct scrape.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IScraperScrapingResult, ScraperOptions } from '@sergienko4/israeli-bank-scrapers';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IScrapeStrategyInputs } from '../../src/Importer/PipelineComposition.js';
import { buildScrapeStrategy } from '../../src/Importer/PipelineComposition.js';
import type { ILogger } from '../../src/Logger/ILogger.js';
import { BankScraper } from '../../src/Scraper/BankScraper.js';
import { createBankRegistry } from '../../src/Scraper/BankRegistry.js';
import createScrapeResultMapper from '../../src/Scraper/Mappers/DefaultScrapeResultMapper.js';
import { createDateRangePolicy } from '../../src/Scraper/Policies/DateRangePolicy.js';
import { ExponentialBackoffRetry } from '../../src/Resilience/RetryStrategy.js';
import { TimeoutWrapper } from '../../src/Resilience/TimeoutWrapper.js';
import { STALE_STAGING_AGE_MS } from '../../src/Storage/SecureJsonStore.js';
import type { IBankConfig } from '../../src/Types/Index.js';
import { fakeBankTransactions, fakeImporterConfig, fakeUuid } from '../helpers/factories.js';
import { TEST_CREDENTIAL } from '../helpers/testCredentials.js';

const provider = vi.hoisted(() => ({ createScraper: vi.fn() }));
vi.mock('@sergienko4/israeli-bank-scrapers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sergienko4/israeli-bank-scrapers')>();
  return { ...actual, createScraper: provider.createScraper };
});

/** Owner read/write only. */
const OWNER_ONLY = 0o600;

/** Mask selecting the permission bits of a file mode. */
const PERMISSION_BITS = 0o777;

/** The config entry name every run scrapes, and the key it is stored under. */
const ENTRY = 'oneZero';
const STORE_KEY = 'onezero:oneZero';

/** Logger whose every call a case can inspect. */
type SpyLogger = { readonly [K in keyof ILogger]: Mock<ILogger[K]> };

/** One run's result and everything it logged. */
interface IRun {
  readonly result: IScraperScrapingResult;
  readonly logger: SpyLogger;
}

/** What the fake provider mints during login and returns afterwards. */
interface IProviderScript {
  readonly longTermToken?: string;
  readonly bearer?: string;
  readonly result: IScraperScrapingResult;
}

/** Env vars each case rewrites, restored afterwards. */
const TOUCHED_ENV = ['BANK_TOKENS_PATH', 'E2E_MOCK_SCRAPER_DIR', 'E2E_MOCK_SCRAPER_FILE'] as const;
const originalEnv = new Map(TOUCHED_ENV.map((name) => [name, process.env[name]]));
let directory = '';
let tokensPath = '';

/**
 * Makes the fake provider fire the login callback, then return a result.
 * @param script - Token to mint, if any, and the result to return.
 * @returns Nothing.
 */
function providerWill(script: IProviderScript): void {
  provider.createScraper.mockImplementation((options: ScraperOptions) => ({
    /**
     * Logs in, reporting the minted token the way the provider does, then scrapes.
     * @returns The scripted result.
     */
    scrape: async (): Promise<IScraperScrapingResult> => {
      if (script.longTermToken !== undefined) {
        const bearer = script.bearer ?? `bearer-${fakeUuid()}`;
        await options.onAuthFlowComplete?.({ longTermToken: script.longTermToken, bearer });
      }
      return script.result;
    },
  }));
}

/**
 * Builds a provider result holding one account with transactions.
 * @returns A successful scrape.
 */
function scrapedAccount(): IScraperScrapingResult {
  const txns = fakeBankTransactions(2, { date: new Date().toISOString() });
  return { success: true, accounts: [{ accountNumber: '4012', txns }] } as IScraperScrapingResult;
}

/**
 * Builds the wiring inputs the composition root receives.
 *
 * Every case scrapes with `twoFactorAuth` on, so only the single-attempt
 * policy runs; the retrying one is the same object so no case can wait on a
 * backoff.
 * @param logger - Logger the run reports through.
 * @returns Inputs with the shipped resilience classes.
 */
function strategyInputs(logger: ILogger): IScrapeStrategyInputs {
  const singleAttempt = new ExponentialBackoffRetry({ maxAttempts: 1, initialBackoffMs: 0 });
  return {
    config: fakeImporterConfig(),
    resilience: {
      retryStrategy: singleAttempt, noRetryStrategy: singleAttempt,
      timeoutWrapper: new TimeoutWrapper(),
    },
    services: { twoFactorPrompter: null, notificationService: { sendMessage: vi.fn() } },
    logger,
  } as unknown as IScrapeStrategyInputs;
}

/**
 * Runs one import of the given config entry through the shipped assembly.
 * @param entry - Name of the `banks` config entry to scrape.
 * @returns The legacy result and the logger the run used.
 */
async function runImport(entry = ENTRY): Promise<IRun> {
  const logger: SpyLogger = {
    debug: vi.fn<ILogger['debug']>(), info: vi.fn<ILogger['info']>(),
    warn: vi.fn<ILogger['warn']>(), error: vi.fn<ILogger['error']>(),
  };
  const scraper = new BankScraper({
    registry: createBankRegistry(),
    strategy: buildScrapeStrategy(strategyInputs(logger)),
    mapper: createScrapeResultMapper(),
    datePolicy: createDateRangePolicy(),
    logger,
  });
  const bankConfig = {
    email: 'operator@example.com', password: TEST_CREDENTIAL,
    phoneNumber: '0501234567', twoFactorAuth: true, daysBack: 7,
  } as IBankConfig;
  const result = await scraper.scrapeBankWithResilience(entry, bankConfig);
  return { result, logger };
}

/**
 * Reads the token file as the next run would.
 * @returns Stored entries by key.
 */
function storedTokens(): Record<string, { token?: string }> {
  return JSON.parse(readFileSync(tokensPath, 'utf8')) as Record<string, { token?: string }>;
}

/**
 * Serialises every argument a run logged, for leak checks.
 * @param logger - Logger the run used.
 * @returns All arguments of all calls as one string.
 */
function everythingLogged(logger: SpyLogger): string {
  const calls = [logger.debug, logger.info, logger.warn, logger.error]
    .flatMap((spy) => spy.mock.calls);
  return JSON.stringify(calls);
}

describe('E2E: long-term token capture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.E2E_MOCK_SCRAPER_DIR;
    delete process.env.E2E_MOCK_SCRAPER_FILE;
    directory = mkdtempSync(join(tmpdir(), 'warm-start-capture-'));
    tokensPath = join(directory, 'bank-tokens.json');
    process.env.BANK_TOKENS_PATH = tokensPath;
  });

  afterEach(() => {
    for (const [name, value] of originalEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });

  it('stores the token a cold login mints, owner-only, under the entry key', async () => {
    const token = `lt-${fakeUuid()}`;
    providerWill({ longTermToken: token, result: scrapedAccount() });

    const { result } = await runImport();

    expect(result.success).toBe(true);
    expect(storedTokens()).toMatchObject({ [STORE_KEY]: { token } });
    expect(statSync(tokensPath).mode & PERMISSION_BITS).toBe(OWNER_ONLY);
  });

  it('keeps the token minted before the scrape failed', async () => {
    const token = `lt-${fakeUuid()}`;
    const failed = { success: false, errorType: 'GENERIC', errorMessage: 'accounts call failed' };
    providerWill({ longTermToken: token, result: failed as IScraperScrapingResult });

    const succeeded = await runImport().then(({ result }) => result.success, () => false);

    expect(succeeded).toBe(false);
    expect(storedTokens()).toMatchObject({ [STORE_KEY]: { token } });
  });

  it('stores a token the provider returned without calling back', async () => {
    const token = `lt-${fakeUuid()}`;
    providerWill({ result: { ...scrapedAccount(), persistentOtpToken: token } });

    await runImport();

    expect(storedTokens()).toMatchObject({ [STORE_KEY]: { token } });
  });

  it('still returns the transactions when the token cannot be stored', async () => {
    process.env.BANK_TOKENS_PATH = join(directory, 'missing', 'bank-tokens.json');
    providerWill({ longTermToken: `lt-${fakeUuid()}`, result: scrapedAccount() });

    const { result, logger } = await runImport();

    expect(result.success).toBe(true);
    expect(result.accounts?.[0]?.txns.length).toBeGreaterThan(0);
    const warnings = JSON.stringify(logger.warn.mock.calls);
    expect(warnings).toContain(`Could not store the long-term token for ${STORE_KEY}`);
  });

  it('never logs the token or the bearer', async () => {
    const token = `lt-${fakeUuid()}`;
    const bearer = `bearer-${fakeUuid()}`;
    providerWill({ longTermToken: token, bearer, result: { ...scrapedAccount(), persistentOtpToken: token } });

    const { logger } = await runImport();

    expect(existsSync(tokensPath)).toBe(true);
    const logged = everythingLogged(logger);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(bearer);
  });

  it('clears a staged token file a killed run left behind', async () => {
    const leftover = `${tokensPath}.${fakeUuid()}.tmp`;
    writeFileSync(leftover, '{}', { mode: OWNER_ONLY });
    const staleSeconds = (Date.now() - STALE_STAGING_AGE_MS) / 1000 - 60;
    utimesSync(leftover, staleSeconds, staleSeconds);
    providerWill({ result: scrapedAccount() });

    await runImport();

    expect(existsSync(leftover)).toBe(false);
  });

  it('leaves the token store alone for a browser bank', async () => {
    providerWill({ result: scrapedAccount() });

    await runImport('discount');

    const options = provider.createScraper.mock.calls[0]?.[0] as ScraperOptions;
    expect(options.onAuthFlowComplete).toBeUndefined();
    expect(existsSync(tokensPath)).toBe(false);
  });
});
