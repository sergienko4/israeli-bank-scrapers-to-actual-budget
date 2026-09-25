/**
 * Shared harness for the long-term token E2E suites.
 *
 * <p>Each suite drives the shipped composition — `buildScrapeStrategy`
 * reading `BANK_TOKENS_PATH`, `BankScraper` resolving the config entry, the
 * live strategy, and `BankTokenStore` on a real temp directory. Only
 * `createScraper` is substituted, because no real bank can be called from a
 * test. The substitution itself must stay in each spec file, where vitest
 * hoists `vi.mock`, so the spec passes its mock in here.
 *
 * <p>The retry and timeout policies are the shipped classes with the shipped
 * single-attempt settings, minus the shutdown handler, which would attach
 * process signal listeners per case. The 2FA prompter and notifier are not
 * reached by an API-direct scrape.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IScraperScrapingResult, ScraperOptions } from '@sergienko4/israeli-bank-scrapers';
import type { Mock } from 'vitest';
import { vi } from 'vitest';

import type { IScrapeStrategyInputs } from '../../../src/Importer/PipelineComposition.js';
import { buildScrapeStrategy } from '../../../src/Importer/PipelineComposition.js';
import type { ILogger } from '../../../src/Logger/ILogger.js';
import { BankScraper } from '../../../src/Scraper/BankScraper.js';
import { createBankRegistry } from '../../../src/Scraper/BankRegistry.js';
import createScrapeResultMapper from '../../../src/Scraper/Mappers/DefaultScrapeResultMapper.js';
import { createDateRangePolicy } from '../../../src/Scraper/Policies/DateRangePolicy.js';
import type { IRetryStrategy } from '../../../src/Resilience/RetryStrategy.js';
import { ExponentialBackoffRetry } from '../../../src/Resilience/RetryStrategy.js';
import { TimeoutWrapper } from '../../../src/Resilience/TimeoutWrapper.js';
import type { IBankConfig } from '../../../src/Types/Index.js';
import { fakeBankTransactions, fakeImporterConfig, fakeUuid } from '../../helpers/factories.js';
import { TEST_CREDENTIAL } from '../../helpers/testCredentials.js';

/** Owner read/write only. */
export const OWNER_ONLY = 0o600;

/** Mask selecting the permission bits of a file mode. */
export const PERMISSION_BITS = 0o777;

/** The config entry name every run scrapes, and the key it is stored under. */
export const ENTRY = 'oneZero';
export const STORE_KEY = 'onezero:oneZero';

/** Logger whose every call a case can inspect. */
export type SpyLogger = { readonly [K in keyof ILogger]: Mock<ILogger[K]> };

/** One run's result and everything it logged. */
export interface IRun {
  readonly result: IScraperScrapingResult;
  readonly logger: SpyLogger;
}

/** What the fake provider mints during login and returns afterwards. */
export interface IProviderScript {
  readonly longTermToken?: string;
  readonly bearer?: string;
  readonly result: IScraperScrapingResult;
}

/** How one import is wired, beyond what every case shares. */
export interface IImportSetup {
  /** Name of the `banks` config entry to scrape. */
  readonly entry?: string;
  /** The entry's 2FA flag; on unless a case says otherwise. */
  readonly twoFactorAuth?: boolean;
  /** Policy for scrapes without 2FA; the single-attempt one unless given. */
  readonly retryStrategy?: IRetryStrategy;
}

/** A temp token file for one case, and the environment it replaced. */
export interface ITokenStoreDir {
  readonly directory: string;
  readonly tokensPath: string;
  readonly originalEnv: ReadonlyMap<string, string | undefined>;
}

/** Env vars each case rewrites, restored afterwards. */
const TOUCHED_ENV = ['BANK_TOKENS_PATH', 'E2E_MOCK_SCRAPER_DIR', 'E2E_MOCK_SCRAPER_FILE'] as const;

/**
 * Points the importer at a fresh temp token file, with no mock-scraper env.
 * @param prefix - Temp directory name prefix, naming the suite.
 * @returns The directory, the token file path and the env to restore.
 */
export function openTokenStore(prefix: string): ITokenStoreDir {
  const originalEnv = new Map(TOUCHED_ENV.map((name) => [name, process.env[name]]));
  delete process.env.E2E_MOCK_SCRAPER_DIR;
  delete process.env.E2E_MOCK_SCRAPER_FILE;
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const tokensPath = join(directory, 'bank-tokens.json');
  process.env.BANK_TOKENS_PATH = tokensPath;
  return { directory, tokensPath, originalEnv };
}

/**
 * Restores the environment and removes the case's temp directory.
 * @param store - What {@link openTokenStore} returned.
 * @returns Nothing.
 */
export function closeTokenStore(store: ITokenStoreDir): void {
  for (const [name, value] of store.originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(store.directory, { recursive: true, force: true });
}

/**
 * Makes the fake provider fire the login callback, then return a result.
 * @param createScraper - The spec's `createScraper` mock.
 * @param script - Token to mint, if any, and the result to return.
 * @returns Nothing.
 */
export function providerWill(createScraper: Mock, script: IProviderScript): void {
  createScraper.mockImplementation((options: ScraperOptions) => ({
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
export function scrapedAccount(): IScraperScrapingResult {
  const txns = fakeBankTransactions(2, { date: new Date().toISOString() });
  return { success: true, accounts: [{ accountNumber: '4012', txns }] } as IScraperScrapingResult;
}

/**
 * Builds the wiring inputs the composition root receives.
 *
 * Unless a case passes a retrying policy, both ports get the single-attempt
 * one, so no case can wait on a backoff.
 * @param logger - Logger the run reports through.
 * @param retryStrategy - Policy for scrapes without 2FA, when a case needs one.
 * @returns Inputs with the shipped resilience classes.
 */
function strategyInputs(logger: ILogger, retryStrategy?: IRetryStrategy): IScrapeStrategyInputs {
  const singleAttempt = new ExponentialBackoffRetry({ maxAttempts: 1, initialBackoffMs: 0 });
  return {
    config: fakeImporterConfig(),
    resilience: {
      retryStrategy: retryStrategy ?? singleAttempt, noRetryStrategy: singleAttempt,
      timeoutWrapper: new TimeoutWrapper(),
    },
    services: { twoFactorPrompter: null, notificationService: { sendMessage: vi.fn() } },
    logger,
  } as unknown as IScrapeStrategyInputs;
}

/**
 * Runs one import of a config entry through the shipped assembly.
 * @param setup - Entry, 2FA flag and retry policy, where a case needs its own.
 * @returns The legacy result and the logger the run used.
 */
export async function runImport(setup: IImportSetup = {}): Promise<IRun> {
  const logger: SpyLogger = {
    debug: vi.fn<ILogger['debug']>(), info: vi.fn<ILogger['info']>(),
    warn: vi.fn<ILogger['warn']>(), error: vi.fn<ILogger['error']>(),
  };
  const scraper = new BankScraper({
    registry: createBankRegistry(),
    strategy: buildScrapeStrategy(strategyInputs(logger, setup.retryStrategy)),
    mapper: createScrapeResultMapper(),
    datePolicy: createDateRangePolicy(),
    logger,
  });
  const bankConfig = {
    email: 'operator@example.com', password: TEST_CREDENTIAL,
    phoneNumber: '0501234567', twoFactorAuth: setup.twoFactorAuth ?? true, daysBack: 7,
  } as IBankConfig;
  const result = await scraper.scrapeBankWithResilience(setup.entry ?? ENTRY, bankConfig);
  return { result, logger };
}

/**
 * Reads the token file as the next run would.
 * @param tokensPath - Path of the case's token file.
 * @returns Stored entries by key.
 */
export function storedTokens(tokensPath: string): Record<string, { token?: string }> {
  return JSON.parse(readFileSync(tokensPath, 'utf8')) as Record<string, { token?: string }>;
}

/**
 * Serialises every argument a run logged, for leak checks.
 * @param logger - Logger the run used.
 * @returns All arguments of all calls as one string.
 */
export function everythingLogged(logger: SpyLogger): string {
  const calls = [logger.debug, logger.info, logger.warn, logger.error]
    .flatMap((spy) => spy.mock.calls);
  return JSON.stringify(calls);
}
