/**
 * E2E: logging in with the stored long-term token through the real import assembly.
 *
 * <p>A long-term token is what lets an unattended run skip the SMS login, and
 * for Pepper and PayBox it logs in by itself, so the token a run sends decides
 * whose account it imports. This suite drives the shipped composition through
 * {@link runImport} against a fake bank that behaves the way that matters: it
 * honours only the latest token it minted for each account, it imports the
 * account the token belongs to, and a cold login costs one SMS code.
 *
 * <p>Each account returns its own account number, so a run that sends a token
 * for the wrong login shows up as the wrong account, not just a wrong call.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { faker } from '@faker-js/faker';
import type { IScraperScrapingResult, ScraperOptions } from '@sergienko4/israeli-bank-scrapers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import loginFingerprint from '../../src/Scraper/Tokens/LoginFingerprint.js';
import type { ITwoFactorPrompter } from '../../src/Services/ITwoFactorPrompter.js';
import type { IBankConfig } from '../../src/Types/Index.js';
import { fakeBankTransactions, fakeCanonicalAccount, fakeUuid, fakeValidBankConfigFor } from '../helpers/factories.js';
import type { IRun, ITokenStoreDir, SpyLogger } from './helpers/warmStartHarness.js';
import {
  closeTokenStore, ENTRY, everythingLogged, openTokenStore, runImport, STORE_KEY, spyLogger, storedTokens,
} from './helpers/warmStartHarness.js';

const provider = vi.hoisted(() => ({ createScraper: vi.fn() }));
vi.mock('@sergienko4/israeli-bank-scrapers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sergienko4/israeli-bank-scrapers')>();
  return { ...actual, createScraper: provider.createScraper };
});

/** The second alias of OneZero, the only way to configure a second OneZero entry. */
const SECOND_ENTRY = 'onezero';

/** What the fake bank reads from the credentials of one login. */
interface IOneZeroLogin {
  readonly email: string;
  readonly otpLongTermToken?: string;
  readonly otpCodeRetriever?: () => Promise<string>;
}

/** A logged-in session: whose account it is, and the token the bank now honours for it. */
interface ISession {
  readonly account: string;
  readonly token: string;
}

/** The bank's memory of the tokens it minted. */
interface IBankLedger {
  /** The long-term token each login sent, in order; undefined for none. */
  readonly sent: (string | undefined)[];
  /** Every token the bank minted, in order. */
  readonly minted: string[];
  /** The account each minted token logs into. */
  readonly ownerOf: Map<string, string>;
  /** The one token the bank still honours for each account. */
  readonly latestOf: Map<string, string>;
}

/** A fake bank, and what a case can do to it. */
interface IFakeBank extends Pick<IBankLedger, 'sent' | 'minted'> {
  /** Revokes an account's current token, as the bank does when it expires. */
  readonly revoke: (account: string) => void;
}

/** One run, and how many SMS codes it asked the operator for. */
interface IReplayRun extends IRun {
  readonly smsCount: number;
}

/** An import that threw, what it logged, and how many SMS codes it asked for. */
interface IFailedRun {
  readonly error: unknown;
  readonly logger: SpyLogger;
  readonly smsCount: number;
}

/** A prompter, and how many SMS codes it has been asked for so far. */
interface ICountingPrompter {
  readonly prompter: ITwoFactorPrompter;
  readonly smsCount: () => number;
}

/** A way the token file can fail, and the warning the run gives for it. */
interface IBrokenStore {
  readonly why: string;
  readonly breakStore: () => void;
  readonly warning: string;
}

let store: ITokenStoreDir;
let bank: IFakeBank;

/**
 * Logs in warm when the token is the latest one the bank minted for its account.
 * @param ledger - The bank's memory.
 * @param token - The long-term token the login sent, if any.
 * @returns The session of the token's owner, or undefined when the token is not honoured.
 */
function warmSession(ledger: IBankLedger, token: string | undefined): ISession | undefined {
  if (token === undefined) return undefined;
  const account = ledger.ownerOf.get(token);
  if (account === undefined || ledger.latestOf.get(account) !== token) return undefined;
  return { account, token };
}

/**
 * Logs in cold: asks for one SMS code, then mints a token that revokes the account's previous one.
 * @param ledger - The bank's memory.
 * @param login - The credentials the login sent.
 * @returns The new session, or undefined when the login cannot ask for a code.
 */
async function coldSession(ledger: IBankLedger, login: IOneZeroLogin): Promise<ISession | undefined> {
  if (login.otpCodeRetriever === undefined) return undefined;
  await login.otpCodeRetriever();
  const token = `lt-${fakeUuid()}`;
  ledger.minted.push(token);
  ledger.ownerOf.set(token, login.email);
  ledger.latestOf.set(login.email, token);
  return { account: login.email, token };
}

/**
 * Names the account an entry logs into; the fake bank keys accounts by email.
 * @param bankConfig - The entry's config.
 * @returns The entry's email.
 */
function accountOf(bankConfig: IBankConfig): string {
  if (bankConfig.email === undefined) throw new Error('A OneZero entry needs an email');
  return bankConfig.email;
}

/**
 * Names the account number the fake bank returns for an account.
 * @param account - The account's email.
 * @returns Its account number.
 */
function accountNumberOf(account: string): string {
  return `acct-${account}`;
}

/**
 * Builds the result of a scrape of one account.
 * @param session - The logged-in session.
 * @returns A successful scrape of the session's account, carrying its token.
 */
function scrapeOf(session: ISession): IScraperScrapingResult {
  const txns = fakeBankTransactions(2, { date: new Date().toISOString() });
  const account = fakeCanonicalAccount({ accountNumber: accountNumberOf(session.account), txns });
  return { success: true, accounts: [account], persistentOtpToken: session.token } as IScraperScrapingResult;
}

/**
 * Makes the provider a bank that honours only the latest token it minted for each account.
 *
 * <p>Like upstream, the provider reports the token it holds through
 * `onAuthFlowComplete` after a warm and after a cold login.
 * @returns The bank's ledger and its revoke control.
 */
function openBank(): IFakeBank {
  const ledger: IBankLedger = { sent: [], minted: [], ownerOf: new Map(), latestOf: new Map() };
  provider.createScraper.mockImplementation((options: ScraperOptions) => ({
    /**
     * Logs in warm or cold, reports the token, then scrapes the session's account.
     * @param login - The credentials the importer built.
     * @returns The scrape, or a failure when a cold login cannot ask for a code.
     */
    scrape: async (login: IOneZeroLogin): Promise<IScraperScrapingResult> => {
      ledger.sent.push(login.otpLongTermToken);
      const session = warmSession(ledger, login.otpLongTermToken) ?? await coldSession(ledger, login);
      if (session === undefined) {
        return { success: false, errorType: 'GENERIC', errorMessage: 'no SMS code retriever' } as IScraperScrapingResult;
      }
      await options.onAuthFlowComplete?.({ longTermToken: session.token, bearer: `bearer-${fakeUuid()}` });
      return scrapeOf(session);
    },
  }));
  return {
    sent: ledger.sent,
    minted: ledger.minted,
    /**
     * Revokes an account's current token.
     * @param account - The account's email.
     * @returns Nothing.
     */
    revoke: (account: string): void => { ledger.latestOf.delete(account); },
  };
}

/**
 * Builds a OneZero config entry with a login of its own and 2FA on.
 * @param overrides - Fields a case pins.
 * @returns The entry.
 */
function oneZeroEntry(overrides: Partial<IBankConfig> = {}): IBankConfig {
  return fakeValidBankConfigFor('onezero', { twoFactorAuth: true, ...overrides });
}

/**
 * Builds a prompter that answers with a fresh SMS code and counts how often it is asked.
 * @returns The prompter and its count.
 */
function countingPrompter(): ICountingPrompter {
  const askForCode = vi.fn(() => Promise.resolve(faker.string.numeric(6)));
  return {
    prompter: { createOtpRetriever: () => askForCode },
    /**
     * Counts the SMS codes asked for so far.
     * @returns The count.
     */
    smsCount: (): number => askForCode.mock.calls.length,
  };
}

/**
 * Imports one entry, with a prompter that counts the SMS codes it is asked for.
 * @param bankConfig - The entry's config.
 * @param entry - The entry's name.
 * @returns The run, and how many SMS codes it asked for.
 */
async function importOnce(bankConfig: IBankConfig, entry = ENTRY): Promise<IReplayRun> {
  const sms = countingPrompter();
  const run = await runImport({ entry, bankConfig, prompter: sms.prompter });
  return { ...run, smsCount: sms.smsCount() };
}

/**
 * Imports one entry whose import throws, keeping what it logged.
 * @param bankConfig - The entry's config.
 * @returns The error, the logger, and how many SMS codes the run asked for.
 */
async function importThatThrows(bankConfig: IBankConfig): Promise<IFailedRun> {
  const sms = countingPrompter();
  const logger = spyLogger();
  const error = await runImport({ bankConfig, prompter: sms.prompter, logger })
    .then((): unknown => undefined, (thrown: unknown) => thrown);
  return { error, logger, smsCount: sms.smsCount() };
}

/**
 * Reads the number of the account a run imported.
 * @param run - The run.
 * @returns The first account's number, if any.
 */
function importedAccount(run: IRun): string | undefined {
  return run.result.accounts?.[0]?.accountNumber;
}

/**
 * Fingerprints an entry's login the way the importer binds tokens.
 * @param bankConfig - The entry's config.
 * @returns The login fingerprint.
 */
function loginOf(bankConfig: IBankConfig): string {
  const login = loginFingerprint('oneZero', bankConfig);
  if (!login.success) throw new Error(login.message);
  return login.data;
}

describe('E2E: long-term token replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = openTokenStore('warm-start-replay-');
    bank = openBank();
  });

  afterEach(() => {
    closeTokenStore(store);
  });

  it('logs in cold with one SMS, then with the stored token and no SMS', async () => {
    const entry = oneZeroEntry();

    const cold = await importOnce(entry);
    const warm = await importOnce(entry);

    expect([cold.smsCount, warm.smsCount]).toEqual([1, 0]);
    expect(bank.sent).toEqual([undefined, bank.minted[0]]);
    expect(importedAccount(warm)).toBe(accountNumberOf(accountOf(entry)));
    expect(JSON.stringify(warm.logger.info.mock.calls))
      .toContain(`Using the stored long-term token for ${STORE_KEY}`);
  });

  it('logs in with the stored token and no SMS when twoFactorAuth is off', async () => {
    const entry = oneZeroEntry();
    await importOnce(entry);

    const unattended = await importOnce({ ...entry, twoFactorAuth: false });

    expect(unattended.result.success).toBe(true);
    expect(unattended.smsCount).toBe(0);
    expect(bank.sent.at(-1)).toBe(bank.minted[0]);
  });

  it('pays one SMS for a revoked token, then logs in with its replacement', async () => {
    const entry = oneZeroEntry();
    await importOnce(entry);
    bank.revoke(accountOf(entry));

    const revoked = await importOnce(entry);
    const replaced = await importOnce(entry);

    expect([revoked.smsCount, replaced.smsCount]).toEqual([1, 0]);
    expect(bank.sent).toEqual([undefined, bank.minted[0], bank.minted[1]]);
    expect(storedTokens(store.tokensPath)[STORE_KEY]?.token).toBe(bank.minted[1]);
  });

  it('keeps a token per entry, so two entries of one bank both log in without SMS', async () => {
    const first = oneZeroEntry();
    const second = oneZeroEntry();
    await importOnce(first, ENTRY);
    await importOnce(second, SECOND_ENTRY);

    const again = [await importOnce(first, ENTRY), await importOnce(second, SECOND_ENTRY)];

    expect(again.map((run) => run.smsCount)).toEqual([0, 0]);
    expect(again.map(importedAccount)).toEqual([
      accountNumberOf(accountOf(first)), accountNumberOf(accountOf(second)),
    ]);
  });

  it('never sends the stored token after the login changes, and binds the new one', async () => {
    const before = oneZeroEntry();
    await importOnce(before);
    const after = { ...before, email: oneZeroEntry().email };

    const changed = await importOnce(after);

    expect(bank.sent[1]).toBeUndefined();
    expect(changed.smsCount).toBe(1);
    expect(importedAccount(changed)).toBe(accountNumberOf(accountOf(after)));
    expect(storedTokens(store.tokensPath)[STORE_KEY]).toMatchObject({ token: bank.minted[1], login: loginOf(after) });
  });

  it('never sends a configured token minted for another login', async () => {
    const owner = oneZeroEntry();
    await importOnce(owner, ENTRY);
    const clone = oneZeroEntry({ otpLongTermToken: bank.minted[0] });

    const cloned = await importOnce(clone, SECOND_ENTRY);

    expect(bank.sent[1]).toBeUndefined();
    expect(importedAccount(cloned)).toBe(accountNumberOf(accountOf(clone)));
    expect(JSON.stringify(cloned.logger.warn.mock.calls)).toContain(
      `The configured long-term token for onezero:${SECOND_ENTRY} belongs to another login, so it is not sent`,
    );
  });

  const brokenStores: IBrokenStore[] = [
    {
      why: 'is damaged',
      breakStore: (): void => {
        rmSync(store.tokensPath);
        mkdirSync(store.tokensPath);
      },
      warning: `The token file is damaged, so the configured long-term token for ${STORE_KEY} is not sent`,
    },
    {
      why: 'cannot be read',
      breakStore: (): void => {
        const notADirectory = join(store.directory, 'not-a-directory');
        writeFileSync(notADirectory, '');
        process.env.BANK_TOKENS_PATH = join(notADirectory, 'bank-tokens.json');
      },
      warning: `Could not read the long-term token for ${STORE_KEY}`,
    },
  ];

  it.each(brokenStores)('sends no token, not even its own configured one, when the token file $why', async ({
    breakStore, warning,
  }) => {
    const entry = oneZeroEntry();
    await importOnce(entry);
    breakStore();

    const broken = await importOnce({ ...entry, otpLongTermToken: bank.minted[0] });

    expect(bank.sent[1]).toBeUndefined();
    expect(broken.smsCount).toBe(1);
    expect(JSON.stringify(broken.logger.warn.mock.calls)).toContain(warning);
  });

  it('fails, and says how to fix it, when twoFactorAuth is off and no token is usable', async () => {
    const entry = oneZeroEntry({ twoFactorAuth: false });

    const stuck = await importThatThrows(entry);

    expect(stuck.error).toBeInstanceOf(Error);
    expect(stuck.smsCount).toBe(0);
    expect(JSON.stringify(stuck.logger.warn.mock.calls)).toContain(
      `No usable long-term token for ${STORE_KEY}, and this run cannot ask for an SMS code: `
      + 'turn on twoFactorAuth for one SMS login, or restore the token file',
    );
  });

  it('never logs a token, cold, warm, revoked or after a login change', async () => {
    const entry = oneZeroEntry();
    const runs = [await importOnce(entry), await importOnce(entry)];
    bank.revoke(accountOf(entry));
    runs.push(await importOnce(entry), await importOnce({ ...entry, email: oneZeroEntry().email }));

    const logged = runs.map((run) => everythingLogged(run.logger)).join('\n');

    expect(bank.minted).toHaveLength(3);
    for (const token of bank.minted) expect(logged).not.toContain(token);
  });
});
