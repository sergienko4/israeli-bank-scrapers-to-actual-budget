/**
 * E2E: capturing a long-term token through the real import assembly.
 *
 * <p>The provider redacts the durable token from its own logs, so the only
 * way an operator ever gets it is if the importer captures it and writes it
 * to disk. This suite drives the shipped composition through
 * {@link runImport} and asserts what the operator relies on: the file is
 * there, owner-only, and the run's transactions never depend on it.
 *
 * <p>The fake provider fires `onAuthFlowComplete` mid-scrape exactly as the
 * real one does, before the result exists. The cases where a try times out
 * also wire the shipped retrying policy and run under fake timers, so the
 * ten-minute deadline and the backoff elapse at once.
 */

import { existsSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IScraperScrapingResult, ScraperOptions } from '@sergienko4/israeli-bank-scrapers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExponentialBackoffRetry } from '../../src/Resilience/RetryStrategy.js';
import { STALE_STAGING_AGE_MS } from '../../src/Storage/SecureJsonStore.js';
import { DEFAULT_RESILIENCE_CONFIG } from '../../src/Types/Index.js';
import { fakeUuid } from '../helpers/factories.js';
import type { ITokenStoreDir } from './helpers/warmStartHarness.js';
import {
  closeTokenStore, everythingLogged, OWNER_ONLY, openTokenStore, PERMISSION_BITS, providerWill,
  runImport, STORE_KEY, scrapedAccount, storedTokens,
} from './helpers/warmStartHarness.js';

const provider = vi.hoisted(() => ({ createScraper: vi.fn() }));
vi.mock('@sergienko4/israeli-bank-scrapers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sergienko4/israeli-bank-scrapers')>();
  return { ...actual, createScraper: provider.createScraper };
});

/** A bank whose first login outlasts the scrape timeout. */
interface IStalledBank {
  /** Tokens in the order the bank minted them; only the last is still honoured. */
  readonly minted: string[];
  /** Every login the provider started, so a case can wait for the abandoned one. */
  readonly logins: Promise<IScraperScrapingResult>[];
  /** Lets the first login report its token. */
  readonly releaseFirstLogin: () => void;
}

let store: ITokenStoreDir;

/**
 * Makes the provider a bank whose first login stalls past the scrape timeout.
 *
 * Each login mints a token that revokes the ones before it. The first login
 * reports its token only once released, as a scrape the timeout abandoned
 * does; later logins report theirs and return at once.
 * @returns The bank's ledger and the release for the first login.
 */
function providerStallsFirstLogin(): IStalledBank {
  const minted: string[] = [];
  const logins: Promise<IScraperScrapingResult>[] = [];
  let releaseFirstLogin: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { releaseFirstLogin = resolve; });
  provider.createScraper.mockImplementation((options: ScraperOptions) => ({
    /**
     * Logs in once, recording the login so the case can await it.
     * @returns The scrape the importer awaits.
     */
    scrape: (): Promise<IScraperScrapingResult> => {
      const login = mintThenReport(options, minted, held);
      logins.push(login);
      return login;
    },
  }));
  return { minted, logins, releaseFirstLogin };
}

/**
 * Mints a token, waits if it is the first login, then reports it both ways.
 * @param options - Provider options carrying the login callback.
 * @param minted - The bank's ledger of minted tokens.
 * @param held - Settles once the case releases the first login.
 * @returns A successful scrape carrying the minted token.
 */
async function mintThenReport(
  options: ScraperOptions, minted: string[], held: Promise<void>,
): Promise<IScraperScrapingResult> {
  const token = `lt-${fakeUuid()}`;
  minted.push(token);
  if (minted.length === 1) await held;
  await options.onAuthFlowComplete?.({ longTermToken: token, bearer: `bearer-${fakeUuid()}` });
  return { ...scrapedAccount(), persistentOtpToken: token };
}

/**
 * Builds the shipped retrying policy, minus the shutdown handler.
 * @returns Retry policy with the shipped attempt budget and backoff.
 */
function shippedRetry(): ExponentialBackoffRetry {
  return new ExponentialBackoffRetry({
    maxAttempts: DEFAULT_RESILIENCE_CONFIG.maxRetryAttempts,
    initialBackoffMs: DEFAULT_RESILIENCE_CONFIG.initialBackoffMs,
    /**
     * Declines to retry a WAF block, as the shipped policy does.
     * @param error - The error from the failed try.
     * @returns True to retry.
     */
    shouldRetry: (error: Error): boolean => error.name !== 'WafBlockError',
  });
}

/**
 * Imports an entry without 2FA whose first login outlasts the timeout.
 *
 * The shipped retrying policy is wired, so only the token-capture rule can
 * keep a second login from starting beside the abandoned one.
 * @returns The bank's ledger, and whether the import succeeded.
 */
async function importWhoseFirstLoginTimesOut(): Promise<{ bank: IStalledBank; succeeded: boolean }> {
  const bank = providerStallsFirstLogin();
  const run = runImport({ twoFactorAuth: false, retryStrategy: shippedRetry() })
    .then(({ result }) => result.success, () => false);
  await vi.runAllTimersAsync();
  return { bank, succeeded: await run };
}

describe('E2E: long-term token capture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = openTokenStore('warm-start-capture-');
  });

  afterEach(() => {
    closeTokenStore(store);
  });

  it('stores the token a cold login mints, owner-only, under the entry key', async () => {
    const token = `lt-${fakeUuid()}`;
    providerWill(provider.createScraper, { longTermToken: token, result: scrapedAccount() });

    const { result } = await runImport();

    expect(result.success).toBe(true);
    expect(storedTokens(store.tokensPath)).toMatchObject({ [STORE_KEY]: { token } });
    expect(statSync(store.tokensPath).mode & PERMISSION_BITS).toBe(OWNER_ONLY);
  });

  it('keeps the token minted before the scrape failed', async () => {
    const token = `lt-${fakeUuid()}`;
    const failed = { success: false, errorType: 'GENERIC', errorMessage: 'accounts call failed' };
    providerWill(provider.createScraper, { longTermToken: token, result: failed as IScraperScrapingResult });

    const succeeded = await runImport().then(({ result }) => result.success, () => false);

    expect(succeeded).toBe(false);
    expect(storedTokens(store.tokensPath)).toMatchObject({ [STORE_KEY]: { token } });
  });

  it('stores a token the provider returned without calling back', async () => {
    const token = `lt-${fakeUuid()}`;
    providerWill(provider.createScraper, { result: { ...scrapedAccount(), persistentOtpToken: token } });

    await runImport();

    expect(storedTokens(store.tokensPath)).toMatchObject({ [STORE_KEY]: { token } });
  });

  it('still returns the transactions when the token cannot be stored', async () => {
    process.env.BANK_TOKENS_PATH = join(store.directory, 'missing', 'bank-tokens.json');
    providerWill(provider.createScraper, { longTermToken: `lt-${fakeUuid()}`, result: scrapedAccount() });

    const { result, logger } = await runImport();

    expect(result.success).toBe(true);
    expect(result.accounts?.[0]?.txns.length).toBeGreaterThan(0);
    const warnings = JSON.stringify(logger.warn.mock.calls);
    expect(warnings).toContain(`Could not store the long-term token for ${STORE_KEY}`);
  });

  it('never logs the token or the bearer', async () => {
    const token = `lt-${fakeUuid()}`;
    const bearer = `bearer-${fakeUuid()}`;
    const scraped = { ...scrapedAccount(), persistentOtpToken: token };
    providerWill(provider.createScraper, { longTermToken: token, bearer, result: scraped });

    const { logger } = await runImport();

    expect(existsSync(store.tokensPath)).toBe(true);
    const logged = everythingLogged(logger);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(bearer);
  });

  it('clears a staged token file a killed run left behind', async () => {
    const leftover = `${store.tokensPath}.${fakeUuid()}.tmp`;
    writeFileSync(leftover, '{}', { mode: OWNER_ONLY });
    const staleSeconds = (Date.now() - STALE_STAGING_AGE_MS) / 1000 - 60;
    utimesSync(leftover, staleSeconds, staleSeconds);
    providerWill(provider.createScraper, { result: scrapedAccount() });

    await runImport();

    expect(existsSync(leftover)).toBe(false);
  });

  it('leaves the token store alone for a browser bank', async () => {
    providerWill(provider.createScraper, { result: scrapedAccount() });

    await runImport({ entry: 'discount' });

    const options = provider.createScraper.mock.calls[0]?.[0] as ScraperOptions;
    expect(options.onAuthFlowComplete).toBeUndefined();
    expect(existsSync(store.tokensPath)).toBe(false);
  });

  describe('when a login outlasts its try', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('ends the attempt after one try, even with 2FA off', async () => {
      const { bank, succeeded } = await importWhoseFirstLoginTimesOut();
      bank.releaseFirstLogin();
      await Promise.allSettled(bank.logins);

      expect(succeeded).toBe(false);
      expect(bank.minted).toHaveLength(1);
    });

    it('stores the token of the login that finished after its try timed out', async () => {
      const { bank } = await importWhoseFirstLoginTimesOut();

      bank.releaseFirstLogin();
      await Promise.allSettled(bank.logins);

      expect(Object.keys(storedTokens(store.tokensPath))).toEqual([STORE_KEY]);
      expect(storedTokens(store.tokensPath)).toMatchObject({ [STORE_KEY]: { token: bank.minted.at(-1) } });
      expect(statSync(store.tokensPath).mode & PERMISSION_BITS).toBe(OWNER_ONLY);
    });
  });
});
