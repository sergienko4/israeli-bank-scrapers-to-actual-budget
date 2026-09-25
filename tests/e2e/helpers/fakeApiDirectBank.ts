/**
 * A fake API-direct bank for the long-term token E2E suites.
 *
 * <p>It stands in for upstream's scraper at `createScraper`, the one seam the
 * importer calls, and behaves the way the importer depends on:
 *
 * <ul>
 *   <li>it knows its customers and refuses a login whose fields are wrong,
 *       warm or cold, so the credentials the importer builds are checked;</li>
 *   <li>a cold login costs one SMS code and mints a JWT-shaped token, which
 *       revokes the account's previous one;</li>
 *   <li>a warm login is honoured only for the latest token of its account and
 *       only while its `exp` is more than 60 seconds ahead of the bank's clock,
 *       as upstream's `jwtClaims` rule decides; an unreadable token is stale;</li>
 *   <li>a warm login opens the account the token belongs to, whatever login
 *       sent it, because a Pepper or PayBox token logs in by itself;</li>
 *   <li>like upstream, it reports the token it holds through
 *       `onAuthFlowComplete` after a warm and after a cold login.</li>
 * </ul>
 *
 * <p>It refuses to serve a scraper built for another bank, so an entry that
 * reaches the wrong scraper fails. The rows it is built from are held against
 * upstream by `ApiDirectBankContract.test.ts`.
 */

import { randomBytes } from 'node:crypto';

import type {
  IScraperScrapingResult, ScraperCredentials, ScraperOptions,
} from '@sergienko4/israeli-bank-scrapers';
import type { Mock } from 'vitest';

import type { IBankConfig } from '../../../src/Types/Index.js';
import type { IApiDirectBank } from '../../helpers/apiDirectBanks.js';
import {
  accountOf, apiDirectEntry, drawAccountValue, loginValuesOf,
} from '../../helpers/apiDirectBanks.js';
import { fakeBankTransactions, fakeCanonicalAccount, fakeUuid } from '../../helpers/factories.js';

/** Seconds before `exp` at which upstream treats a token as stale (`jwtClaims.skewSeconds`). */
const FRESHNESS_SKEW_SECONDS = 60;

/** A fake bank, and what a case can do to it. */
export interface IFakeApiDirectBank {
  /** The long-term token each login sent, in order; undefined for none. */
  readonly sent: readonly (string | undefined)[];
  /** Every token the bank minted, in order. */
  readonly minted: readonly string[];
  /**
   * Opens an account with a login of its own and returns its `banks` entry.
   * @param overrides - Entry fields a case pins.
   * @returns The entry.
   */
  readonly customer: (overrides?: Partial<IBankConfig>) => IBankConfig;
  /**
   * Moves an entry to a new account of its own, as when the operator edits the login.
   * @param bankConfig - The entry.
   * @returns The entry, logging in to the new account.
   */
  readonly movedTo: (bankConfig: IBankConfig) => IBankConfig;
  /**
   * Mints a token for an entry's account without an SMS, as an earlier login elsewhere did.
   * @param bankConfig - The entry.
   * @returns The token.
   */
  readonly mintElsewhere: (bankConfig: IBankConfig) => string;
  /**
   * Revokes the account's current token.
   * @param bankConfig - An entry of the account.
   * @returns Nothing.
   */
  readonly revoke: (bankConfig: IBankConfig) => void;
  /**
   * Moves the bank's clock to where the account's current token is stale.
   * @param bankConfig - An entry of the account.
   * @returns Nothing.
   */
  readonly expire: (bankConfig: IBankConfig) => void;
}

/** A logged-in session: whose account it is, and the token the bank now honours for it. */
interface ISession {
  readonly account: string;
  readonly token: string;
}

/** What the bank remembers. */
interface IBankState {
  readonly bank: IApiDirectBank;
  readonly sent: (string | undefined)[];
  readonly minted: string[];
  /** The login field values of each account, by account. */
  readonly customers: Map<string, Readonly<Record<string, unknown>>>;
  /** The account each minted token logs in to. */
  readonly ownerOf: Map<string, string>;
  /** The one token the bank still honours for each account. */
  readonly latestOf: Map<string, string>;
  /** The bank's clock, in seconds since the epoch. */
  readonly clock: { now: number };
}

/**
 * Encodes a value as one base64url JWT segment.
 * @param value - Header or payload.
 * @returns The segment.
 */
function segmentOf(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * Mints a JWT-shaped token for an account and makes it the one the bank honours.
 * @param state - The bank's memory.
 * @param account - The account the token logs in to.
 * @returns The token.
 */
function mint(state: IBankState, account: string): string {
  const iat = state.clock.now;
  const payload = { iat, exp: iat + state.bank.tokenLifetimeSeconds, jti: fakeUuid(), ...state.bank.tokenClaims() };
  const signature = randomBytes(32).toString('base64url');
  const token = `${segmentOf({ alg: 'RS256', typ: 'JWT' })}.${segmentOf(payload)}.${signature}`;
  state.minted.push(token);
  state.ownerOf.set(token, account);
  state.latestOf.set(account, token);
  return token;
}

/**
 * Reads a token's `exp` claim, the way upstream does: anything unreadable has none.
 * @param token - The token.
 * @returns The claim, or undefined when the token has no numeric `exp`.
 */
function expOf(token: string): number | undefined {
  const payload = token.split('.')[1] ?? '';
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const exp: unknown = (claims as { exp?: unknown } | null)?.exp;
    return typeof exp === 'number' ? exp : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Tells whether the bank still accepts a token's age.
 * @param state - The bank's memory.
 * @param token - The token.
 * @returns True while `exp` is more than the skew ahead of the bank's clock.
 */
function isFresh(state: IBankState, token: string): boolean {
  const exp = expOf(token);
  return exp !== undefined && exp > state.clock.now + FRESHNESS_SKEW_SECONDS;
}

/**
 * Reads the long-term token a login sent, by upstream's own credential field.
 * @param credentials - What the importer sent.
 * @returns The token, or undefined when none was sent.
 */
function tokenIn(credentials: ScraperCredentials): string | undefined {
  return 'otpLongTermToken' in credentials ? credentials.otpLongTermToken : undefined;
}

/**
 * Reads the SMS code retriever a login sent, by upstream's own credential field.
 * @param credentials - What the importer sent.
 * @returns The retriever, or undefined when the login cannot ask for a code.
 */
function retrieverIn(credentials: ScraperCredentials): (() => Promise<string>) | undefined {
  return 'otpCodeRetriever' in credentials ? credentials.otpCodeRetriever : undefined;
}

/**
 * Names the customer whose login fields a login sent, if they all match.
 * @param state - The bank's memory.
 * @param credentials - What the importer sent.
 * @returns The account, or undefined when the bank does not know the login.
 */
function customerOf(state: IBankState, credentials: ScraperCredentials): string | undefined {
  const sent = credentials as Readonly<Record<string, unknown>>;
  const account = sent[state.bank.accountField];
  if (typeof account !== 'string') return undefined;
  const known = state.customers.get(account);
  if (known === undefined) return undefined;
  const matches = state.bank.loginFields.every((field) => sent[field] === known[field]);
  return matches ? account : undefined;
}

/**
 * Logs in warm when the token is the latest, fresh one the bank minted for its account.
 * @param state - The bank's memory.
 * @param token - The long-term token the login sent, if any.
 * @returns The session of the token's owner, or undefined when the token is not honoured.
 */
function warmSession(state: IBankState, token: string | undefined): ISession | undefined {
  if (token === undefined) return undefined;
  const account = state.ownerOf.get(token);
  if (account === undefined || state.latestOf.get(account) !== token) return undefined;
  return isFresh(state, token) ? { account, token } : undefined;
}

/**
 * Logs in cold: asks for one SMS code, then mints a token.
 * @param state - The bank's memory.
 * @param credentials - What the importer sent.
 * @param account - The customer the login fields name.
 * @returns The new session, or undefined when the login cannot ask for a code.
 */
async function coldSession(
  state: IBankState, credentials: ScraperCredentials, account: string,
): Promise<ISession | undefined> {
  const retriever = retrieverIn(credentials);
  if (retriever === undefined) return undefined;
  await retriever();
  return { account, token: mint(state, account) };
}

/**
 * Names the account number the fake bank returns for an account.
 * @param account - The account's email or phone number.
 * @returns Its account number.
 */
export function accountNumberOf(account: string): string {
  return `acct-${account}`;
}

/**
 * Builds a failed scrape.
 * @param errorType - Upstream's error type.
 * @param errorMessage - Why.
 * @returns The failure.
 */
function refused(errorType: string, errorMessage: string): IScraperScrapingResult {
  return { success: false, errorType, errorMessage } as IScraperScrapingResult;
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
 * Logs in warm or cold, reports the token, then scrapes the session's account.
 * @param state - The bank's memory.
 * @param options - The options the importer built the scraper with.
 * @param credentials - The credentials the importer sent.
 * @returns The scrape, or why the bank refused it.
 */
async function scrape(
  state: IBankState, options: ScraperOptions, credentials: ScraperCredentials,
): Promise<IScraperScrapingResult> {
  const token = tokenIn(credentials);
  state.sent.push(token);
  if (options.companyId !== state.bank.companyType) return refused('GENERIC', 'another bank\'s scraper');
  const account = customerOf(state, credentials);
  if (account === undefined) return refused('INVALID_PASSWORD', 'unknown login');
  const session = warmSession(state, token) ?? await coldSession(state, credentials, account);
  if (session === undefined) return refused('TWO_FACTOR_RETRIEVER_MISSING', 'no SMS code retriever');
  await options.onAuthFlowComplete?.({ longTermToken: session.token, bearer: `bearer-${fakeUuid()}` });
  return scrapeOf(session);
}

/**
 * Draws an account value no customer has yet.
 * @param state - The bank's memory.
 * @returns The value.
 */
function unusedAccount(state: IBankState): string {
  let value = drawAccountValue(state.bank);
  while (state.customers.has(value)) value = drawAccountValue(state.bank);
  return value;
}

/**
 * Records an entry's login as a customer of the bank.
 * @param state - The bank's memory.
 * @param bankConfig - The entry.
 * @returns The same entry.
 */
function register(state: IBankState, bankConfig: IBankConfig): IBankConfig {
  const account = accountOf(state.bank, bankConfig);
  if (state.customers.has(account)) throw new Error(`${account} is already a customer`);
  state.customers.set(account, loginValuesOf(state.bank, bankConfig));
  return bankConfig;
}

/**
 * Names the token the bank honours for an entry's account.
 * @param state - The bank's memory.
 * @param bankConfig - An entry of the account.
 * @returns The token.
 */
function latestTokenOf(state: IBankState, bankConfig: IBankConfig): string {
  const token = state.latestOf.get(accountOf(state.bank, bankConfig));
  if (token === undefined) throw new Error('The account holds no token');
  return token;
}

/**
 * Builds the case controls over the bank's memory.
 * @param state - The bank's memory.
 * @returns The controls.
 */
function controlsOf(state: IBankState): IFakeApiDirectBank {
  const { bank } = state;
  return {
    sent: state.sent,
    minted: state.minted,
    /**
     * Opens an account with a login of its own.
     * @param overrides - Entry fields a case pins.
     * @returns The entry.
     */
    customer: (overrides = {}) => register(state, apiDirectEntry(bank, {
      [bank.accountField]: unusedAccount(state), ...overrides,
    })),
    /**
     * Moves an entry to a new account of its own.
     * @param bankConfig - The entry.
     * @returns The entry, logging in to the new account.
     */
    movedTo: (bankConfig) => register(state, { ...bankConfig, [bank.accountField]: unusedAccount(state) }),
    /**
     * Mints a token for an entry's account without an SMS.
     * @param bankConfig - The entry.
     * @returns The token.
     */
    mintElsewhere: (bankConfig) => mint(state, accountOf(bank, bankConfig)),
    /**
     * Revokes the account's current token.
     * @param bankConfig - An entry of the account.
     * @returns Nothing.
     */
    revoke: (bankConfig): void => { state.latestOf.delete(accountOf(bank, bankConfig)); },
    /**
     * Moves the bank's clock to where the account's current token is stale.
     * @param bankConfig - An entry of the account.
     * @returns Nothing.
     */
    expire: (bankConfig): void => {
      const exp = expOf(latestTokenOf(state, bankConfig));
      if (exp === undefined) throw new Error('The token has no exp');
      state.clock.now = exp - FRESHNESS_SKEW_SECONDS;
    },
  };
}

/**
 * Makes the provider one API-direct bank.
 * @param createScraper - The spec's `createScraper` mock.
 * @param bank - The bank to fake.
 * @returns The case controls.
 */
export function openApiDirectBank(createScraper: Mock, bank: IApiDirectBank): IFakeApiDirectBank {
  const state: IBankState = {
    bank, sent: [], minted: [], customers: new Map(), ownerOf: new Map(), latestOf: new Map(),
    clock: { now: Math.floor(Date.now() / 1000) },
  };
  createScraper.mockImplementation((options: ScraperOptions) => ({
    /**
     * Logs in and scrapes, as the bank does.
     * @param credentials - The credentials the importer built.
     * @returns The scrape, or why the bank refused it.
     */
    scrape: (credentials: ScraperCredentials): Promise<IScraperScrapingResult> => scrape(state, options, credentials),
  }));
  return controlsOf(state);
}
