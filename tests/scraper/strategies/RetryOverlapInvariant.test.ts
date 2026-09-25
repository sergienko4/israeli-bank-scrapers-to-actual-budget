/**
 * Overlap invariant: a login that mints a durable token never races another.
 *
 * <p>The timeout abandons a scrape rather than cancelling it, so a timed-out
 * try can still be logging in while the retry policy starts the next one. For
 * a bank that mints a long-term token, every login revokes the token before
 * it, so the store must end up holding the token the bank minted last. The
 * fake bank here keeps a ledger of what it minted and holds the first try's
 * login until the scrape has returned, then lets it finish; the store is then
 * compared with the ledger's newest entry.
 *
 * <p>The ledger is the oracle, not the policy the strategy picked: the cases
 * pass only if no minted token can land after a newer one, whatever the
 * retry decision is built on. Browser banks mint nothing, so their retries
 * must survive unchanged.
 */

import type { ScraperOptions } from '@sergienko4/israeli-bank-scrapers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TimeoutError from '../../../src/Errors/TimeoutError.js';
import { ExponentialBackoffRetry } from '../../../src/Resilience/RetryStrategy.js';
import type { ITimeoutWrapper } from '../../../src/Resilience/TimeoutWrapper.js';
import type { IBankScrapeStrategyOpts } from '../../../src/Scraper/Strategies/IBankScrapeStrategy.js';
import { LiveScrapeStrategy } from '../../../src/Scraper/Strategies/LiveScrapeStrategy.js';
import type { ITwoFactorPrompter } from '../../../src/Services/ITwoFactorPrompter.js';
import { fakeBankConfig, fakeImporterConfig } from '../../helpers/factories.js';
import type { IStoreUnderTest } from '../BankTokenStoreFixture.js';
import { makeStore } from '../BankTokenStoreFixture.js';

const provider = vi.hoisted(() => ({ createScraper: vi.fn() }));
vi.mock('@sergienko4/israeli-bank-scrapers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sergienko4/israeli-bank-scrapers')>();
  return { ...actual, createScraper: provider.createScraper };
});

vi.mock('../../../src/Scraper/ScraperOptionsBuilder.js', () => ({
  buildChromeArgs: vi.fn(() => []),
  getChromeDataDir: vi.fn(() => '/mock/chrome'),
}));

/** Config entry every case scrapes; its store key is `<bankId>:<ENTRY>`. */
const ENTRY = 'primary';

/** A fake bank: each login mints a token that revokes every earlier one. */
interface IFakeBank {
  /** Tokens in the order the bank minted them; the last is the only live one. */
  readonly minted: string[];
  /** Every provider scrape started, so a case can wait for the abandoned one. */
  readonly logins: Promise<unknown>[];
  /** Lets the held first login report its token. */
  readonly releaseFirstLogin: () => void;
}

/** One row of the matrix: what the operator configured and what ran. */
interface IOverlapRow {
  readonly bankId: 'oneZero' | 'discount';
  readonly twoFactorAuth: boolean | undefined;
  readonly hasPrompter: boolean;
  readonly hasInjectedRetriever: boolean;
}

/**
 * Makes the provider a bank whose first login stalls past the timeout.
 *
 * The first try mints its token at once but reports it only after the case
 * releases it, the way a scrape the timeout abandoned logs in late. Later
 * tries mint, report and succeed immediately.
 * @returns The bank's ledger and the release for the first login.
 */
function bankWithStalledFirstLogin(): IFakeBank {
  const minted: string[] = [];
  const logins: Promise<unknown>[] = [];
  let releaseFirstLogin: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { releaseFirstLogin = resolve; });
  provider.createScraper.mockImplementation((options: ScraperOptions) => ({
    /**
     * Logs in once, recording the attempt so the case can await it.
     * @returns The scrape the importer awaits.
     */
    scrape: (): Promise<unknown> => {
      const login = logIn({ options, minted, held });
      logins.push(login);
      return login;
    },
  }));
  return { minted, logins, releaseFirstLogin };
}

/** What one fake login reads and writes. */
interface ILoginInputs {
  readonly options: ScraperOptions;
  readonly minted: string[];
  readonly held: Promise<void>;
}

/**
 * Mints a token, waits if it is the first login, then reports it.
 *
 * The token is reported twice, as the provider does: through the login
 * callback, and in the result for the importer's backstop write.
 * @param inputs - Provider options, the ledger and the first-login hold.
 * @returns A successful, empty scrape carrying the minted token.
 */
async function logIn(inputs: ILoginInputs): Promise<unknown> {
  const token = `long-term-${String(inputs.minted.length + 1)}`;
  inputs.minted.push(token);
  if (inputs.minted.length === 1) await inputs.held;
  await inputs.options.onAuthFlowComplete?.({ longTermToken: token, bearer: 'short-lived' });
  return { success: true, accounts: [], persistentOtpToken: token };
}

/**
 * Builds a timeout that abandons the first scrape and lets later ones finish.
 * @returns Timeout wrapper rejecting its first call the way the real one does.
 */
function timeoutOnFirstTry(): ITimeoutWrapper {
  let calls = 0;
  return {
    /**
     * Rejects the first scrape as timed out and passes later ones through.
     * @param promise - The provider scrape being raced against the deadline.
     * @param timeoutMs - Deadline reported in the timeout error.
     * @param operationName - Label reported in the timeout error.
     * @returns The scrape's result from the second call on.
     */
    wrap: async <T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> => {
      calls += 1;
      if (calls === 1) throw new TimeoutError(operationName, timeoutMs);
      return await promise;
    },
  };
}

/**
 * Builds a strategy with the shipped retry settings and no backoff delay.
 * @param row - Matrix row deciding whether a 2FA prompter is wired.
 * @param subject - Store the capture writes to.
 * @returns Strategy under test.
 */
function makeStrategy(row: IOverlapRow, subject: IStoreUnderTest): LiveScrapeStrategy {
  const prompter: ITwoFactorPrompter = { createOtpRetriever: () => async () => '123456' };
  return new LiveScrapeStrategy({
    config: fakeImporterConfig(),
    retryStrategy: new ExponentialBackoffRetry({
      maxAttempts: 3, initialBackoffMs: 0,
      shouldRetry: (error: Error): boolean => error.name !== 'WafBlockError',
    }),
    noRetryStrategy: new ExponentialBackoffRetry({ maxAttempts: 1, initialBackoffMs: 0 }),
    timeoutWrapper: timeoutOnFirstTry(),
    twoFactorPrompter: row.hasPrompter ? prompter : null,
    notificationService: { sendMessage: vi.fn() } as never,
    bankTokens: subject.store,
  });
}

/**
 * Builds the scrape options for one matrix row.
 * @param row - Bank, 2FA flag and whether a retriever is injected.
 * @returns Options for strategy.scrape().
 */
function makeOpts(row: IOverlapRow): IBankScrapeStrategyOpts {
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    bankId: row.bankId.toLowerCase(), companyType: row.bankId as never,
    bankConfig: fakeBankConfig({ twoFactorAuth: row.twoFactorAuth }),
    accountKey: ENTRY, startDate: new Date(), logger,
    ...(row.hasInjectedRetriever ? { otpRetriever: async () => '654321' } : {}),
  };
}

/**
 * Runs one scrape, then lets the abandoned first login finish.
 *
 * A single-try policy rethrows the timeout, so the scrape may reject; either
 * way it is over before the stalled login reports its token.
 * @param row - Matrix row to run.
 * @param subject - Store the capture writes to.
 * @returns The fake bank's ledger once every login has settled.
 */
async function scrapeThenLetStalledLoginFinish(
  row: IOverlapRow, subject: IStoreUnderTest,
): Promise<IFakeBank> {
  const bank = bankWithStalledFirstLogin();
  await Promise.allSettled([makeStrategy(row, subject).scrape(makeOpts(row))]);
  bank.releaseFirstLogin();
  await Promise.allSettled(bank.logins);
  return bank;
}

/**
 * Reads what the next run would replay for this row's account.
 * @param row - Matrix row whose account key is read.
 * @param subject - Store under test.
 * @returns The stored token, or an empty string.
 */
function storedToken(row: IOverlapRow, subject: IStoreUnderTest): string {
  const read = subject.store.read(`${row.bankId.toLowerCase()}:${ENTRY}`);
  return read.success ? read.data : `unreadable: ${read.message}`;
}

/**
 * Expands every combination of the inputs that decide whether an OTP exists.
 * @param bankId - Bank the rows scrape.
 * @returns One row per 2FA flag, prompter and injected-retriever combination.
 */
function rowsFor(bankId: IOverlapRow['bankId']): IOverlapRow[] {
  const flags: (boolean | undefined)[] = [true, false, undefined];
  return flags.flatMap((twoFactorAuth) => [true, false].flatMap((hasPrompter) =>
    [true, false].map((hasInjectedRetriever) =>
      ({ bankId, twoFactorAuth, hasPrompter, hasInjectedRetriever }))));
}

describe('retry overlap invariant', () => {
  beforeEach(() => {
    provider.createScraper.mockReset();
  });

  it.each(rowsFor('oneZero'))(
    'an API-direct bank stores the newest token the bank minted (2FA $twoFactorAuth, prompter $hasPrompter, retriever $hasInjectedRetriever)',
    async (row: IOverlapRow) => {
      const subject = makeStore();
      const bank = await scrapeThenLetStalledLoginFinish(row, subject);
      expect(storedToken(row, subject)).toBe(bank.minted.at(-1));
    },
  );

  it.each(rowsFor('oneZero'))(
    'an API-direct bank never starts a second login while one is running (2FA $twoFactorAuth, prompter $hasPrompter, retriever $hasInjectedRetriever)',
    async (row: IOverlapRow) => {
      const bank = await scrapeThenLetStalledLoginFinish(row, makeStore());
      expect(bank.minted).toHaveLength(1);
    },
  );

  it.each(rowsFor('discount'))(
    'a browser bank keeps its retry after a timeout unless 2FA is on (2FA $twoFactorAuth, prompter $hasPrompter, retriever $hasInjectedRetriever)',
    async (row: IOverlapRow) => {
      const subject = makeStore();
      const bank = await scrapeThenLetStalledLoginFinish(row, subject);
      expect(bank.minted).toHaveLength(row.twoFactorAuth === true ? 1 : 2);
      expect(storedToken(row, subject)).toBe('');
    },
  );
});
