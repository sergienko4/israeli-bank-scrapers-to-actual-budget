/**
 * Retiring a long-term token whose run ended on upstream's one-cold-login budget.
 *
 * <p>When a login that carries a token fails before the SMS step, upstream
 * refuses the second cold login it needs and reports that refusal instead of
 * the first failure. These cases pin which results count as that, and what
 * the importer then records and removes. The journey through the shipped
 * assembly is `tests/e2e/WarmStartReplay.e2e.test.ts`.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';
import { describe, expect, it, vi } from 'vitest';

import type { ILogger } from '../../src/Logger/ILogger.js';
import type { IBankTokenStore } from '../../src/Scraper/Tokens/BankTokenStore.js';
import type { IRefusedTokens } from '../../src/Scraper/Tokens/RefusedTokens.js';
import tokenDigest from '../../src/Scraper/Tokens/TokenDigest.js';
import retireRefusedToken from '../../src/Scraper/Tokens/TokenRefusal.js';
import type { IWarmTokenWatch, WarmTokenSource } from '../../src/Scraper/Tokens/WarmTokenWatch.js';
import { NO_TOKEN_SENT } from '../../src/Scraper/Tokens/WarmTokenWatch.js';
import { fail } from '../../src/Types/ProcedureHelpers.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';
import {
  ACCOUNT_LOGIN, CAPTURED_AT, fakeToken, makeRefusals, makeStore, OWNER_ONLY, REFUSED_PATH,
  seedRecords, storedRecords,
} from './BankTokenStoreFixture.js';

/** The key a `oneZero` config entry resolves to. */
const STORE_KEY = 'onezero:oneZero';

/** Upstream's failure when a run needs a second cold login (`BUDGET_SPENT_MESSAGE`). */
const BUDGET_SPENT = 'this scrape has already spent its one cold SMS login; '
  + 'the session cannot be re-minted in-run \u2014 start a new scrape';

/** A watch over a sent token, and the token it digests. */
interface ISentWatch {
  readonly watch: IWarmTokenWatch;
  readonly token: string;
}

/**
 * Builds a logger whose every level is a spy.
 * @returns The logger.
 */
function spyLogger(): ILogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * Builds the watch of an attempt that sent a token.
 * @param source - Where the token came from.
 * @param token - The token sent; a fresh one unless given.
 * @returns The watch and the token.
 */
function sentFrom(source: WarmTokenSource, token = fakeToken()): ISentWatch {
  const digest = tokenDigest(token);
  return { watch: { storeKey: STORE_KEY, logger: spyLogger(), decision: { source, digest } }, token };
}

/**
 * Builds a failed provider result.
 * @param errorType - Upstream's error type.
 * @param errorMessage - Upstream's message.
 * @returns The failure.
 */
function failedWith(errorType: string, errorMessage = BUDGET_SPENT): IScraperScrapingResult {
  return { success: false, errorType, errorMessage } as IScraperScrapingResult;
}

/**
 * Reads every warning a watch logged.
 * @param watch - The watch.
 * @returns The warnings, in order.
 */
function warningsOf(watch: IWarmTokenWatch): string[] {
  return vi.mocked(watch.logger.warn).mock.calls.map(([line]) => String(line));
}

/**
 * Serialises everything a watch's logger received, for leak checks.
 * @param watch - The watch.
 * @returns Every argument of every call.
 */
function everythingLogged(watch: IWarmTokenWatch): string {
  const { logger } = watch;
  const spies = [logger.debug, logger.info, logger.warn, logger.error].map((spy) => vi.mocked(spy));
  return JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
}

/**
 * Tells whether the registry refuses a token.
 * @param refusals - Registry to ask.
 * @param token - Token to check.
 * @returns True when the token's digest is recorded.
 */
function isRefused(refusals: IRefusedTokens, token: string): boolean {
  const view = refusals.read();
  if (!view.success) throw new Error(`read failed: ${view.message}`);
  const digest = tokenDigest(token);
  return view.data.has(digest);
}

/**
 * Stores a token for the entry, bound to the account's login.
 * @param fileSystem - The store's filesystem.
 * @param token - Token to store.
 * @returns Nothing.
 */
function storeToken(fileSystem: FakeFileSystem, token: string): void {
  seedRecords(fileSystem, { [STORE_KEY]: { token, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
}

/** What the importer warns once it retired a token. */
const retiredOf = (source: WarmTokenSource): string =>
  `  ⚠️  The ${source} long-term token for ${STORE_KEY} was not accepted; `
  + 'it is retired, so the next run logs in without it';

/** What the importer warns when it could not retire a token. */
const notRetiredOf = (source: WarmTokenSource): string =>
  `  ⚠️  The ${source} long-term token for ${STORE_KEY} was not accepted and could not be retired, `
  + 'so the next run may repeat this — remove otpLongTermToken';

/** What a retirement left behind. */
interface IRetirementTrace {
  readonly isRetired: boolean;
  readonly didRecord: boolean;
  readonly isTokenKept: boolean;
}

/**
 * Runs a retirement over fresh stores, the token store holding the sent token.
 * @param result - The attempt's provider result.
 * @param sent - The attempt's watch and the token it sent.
 * @returns Whether it retired, recorded a refusal, and kept the stored token.
 */
function retireOver(result: IScraperScrapingResult, sent: ISentWatch): IRetirementTrace {
  const { store, fileSystem } = makeStore();
  const refusals = makeRefusals(fileSystem);
  storeToken(fileSystem, sent.token);
  const isRetired = retireRefusedToken(sent.watch, result, { bankTokens: store, refusedTokens: refusals });
  const isTokenKept = STORE_KEY in storedRecords(fileSystem);
  return { isRetired, didRecord: fileSystem.hasEntry(REFUSED_PATH), isTokenKept };
}

describe('which results retire the token', () => {
  it.each(['stored', 'configured'] as const)('retires a %s token after the budget failure', (source) => {
    const trace = retireOver(failedWith('GENERIC'), sentFrom(source));

    expect(trace).toEqual({ isRetired: true, didRecord: true, isTokenKept: source === 'configured' });
  });

  it('matches the budget failure whatever its case', () => {
    const shouted = failedWith('GENERIC', BUDGET_SPENT.toUpperCase());

    expect(retireOver(shouted, sentFrom('stored'))).toMatchObject({ isRetired: true, didRecord: true });
  });

  it.each([
    { why: 'a success', result: { success: true, accounts: [] } as IScraperScrapingResult },
    { why: 'another GENERIC failure', result: failedWith('GENERIC', 'POST /otp/prepare 500: down') },
    { why: 'a missing OTP retriever', result: failedWith('TWO_FACTOR_RETRIEVER_MISSING') },
    { why: 'a timeout that quotes the budget', result: failedWith('TIMEOUT') },
    { why: 'a failure with no message', result: { success: false, errorType: 'GENERIC' } as IScraperScrapingResult },
  ])('leaves the token alone after $why', ({ result }) => {
    const sent = sentFrom('stored');

    expect(retireOver(result, sent)).toEqual({ isRetired: false, didRecord: false, isTokenKept: true });
    expect(sent.watch.logger.warn).not.toHaveBeenCalled();
  });

  it('leaves everything alone when the attempt sent no token', () => {
    const watch: IWarmTokenWatch = { storeKey: STORE_KEY, logger: spyLogger(), decision: NO_TOKEN_SENT };
    const token = fakeToken();

    expect(retireOver(failedWith('GENERIC'), { watch, token })).toEqual({
      isRetired: false, didRecord: false, isTokenKept: true,
    });
    expect(watch.logger.warn).not.toHaveBeenCalled();
  });
});

describe('retireRefusedToken', () => {
  it('records a refused stored token and removes it from the store', () => {
    const { store, fileSystem } = makeStore();
    const refusals = makeRefusals(fileSystem);
    const { watch, token } = sentFrom('stored');
    storeToken(fileSystem, token);

    const isRetired = retireRefusedToken(watch, failedWith('GENERIC'), { bankTokens: store, refusedTokens: refusals });

    expect(isRetired).toBe(true);
    expect(JSON.parse(fileSystem.contentsOf(REFUSED_PATH))).toEqual({ [STORE_KEY]: [tokenDigest(token)] });
    expect(storedRecords(fileSystem)).toEqual({});
    expect(warningsOf(watch)).toEqual([retiredOf('stored')]);
  });

  it('keeps a token the store gained since the attempt read it', () => {
    const { store, fileSystem } = makeStore();
    const refusals = makeRefusals(fileSystem);
    const { watch, token } = sentFrom('stored');
    const minted = fakeToken();
    storeToken(fileSystem, minted);

    retireRefusedToken(watch, failedWith('GENERIC'), { bankTokens: store, refusedTokens: refusals });

    expect(isRefused(refusals, token)).toBe(true);
    expect(isRefused(refusals, minted)).toBe(false);
    expect(storedRecords(fileSystem)).toEqual({
      [STORE_KEY]: { token: minted, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN },
    });
  });

  it('records a refused configured token and leaves the store alone', () => {
    const { store, fileSystem } = makeStore();
    const refusals = makeRefusals(fileSystem);
    const { watch, token } = sentFrom('configured');
    const removeMatching = vi.spyOn(store, 'removeMatching');

    const isRetired = retireRefusedToken(watch, failedWith('GENERIC'), { bankTokens: store, refusedTokens: refusals });

    expect(isRetired).toBe(true);
    expect(isRefused(refusals, token)).toBe(true);
    expect(removeMatching).not.toHaveBeenCalled();
    expect(warningsOf(watch)).toEqual([retiredOf('configured')]);
  });

  it('says it could not retire the token when the refusal cannot be saved, and still removes the stored copy', () => {
    const { store, fileSystem } = makeStore();
    const refusalVolume = new FakeFileSystem();
    const refusals = makeRefusals(refusalVolume);
    refusalVolume.seedFile(REFUSED_PATH, '{}', OWNER_ONLY);
    refusalVolume.forcedFailures.set('openForRead', 'EACCES');
    const { watch, token } = sentFrom('stored');
    storeToken(fileSystem, token);

    const isRetired = retireRefusedToken(watch, failedWith('GENERIC'), { bankTokens: store, refusedTokens: refusals });

    expect(isRetired).toBe(false);
    expect(storedRecords(fileSystem)).toEqual({});
    const warnings = warningsOf(watch);
    expect(warnings[0]).toMatch(new RegExp(`^  ⚠️  Could not record the refused long-term token for ${STORE_KEY}: .*EACCES`, 'u'));
    expect(warnings.slice(1)).toEqual([notRetiredOf('stored')]);
  });

  it('warns rather than throws when either store throws', () => {
    /**
     * Fails the way an unexpected adapter bug would.
     * @returns Never returns.
     */
    const explode = (): never => {
      throw new Error('EIO: i/o error');
    };
    const bankTokens: IBankTokenStore = {
      read: explode, write: explode, remove: explode, removeMatching: explode, sweepStagedLeftovers: explode,
    };
    const refusedTokens: IRefusedTokens = { read: explode, refuse: explode, sweepStagedLeftovers: explode };
    const { watch } = sentFrom('stored');

    const isRetired = retireRefusedToken(watch, failedWith('GENERIC'), { bankTokens, refusedTokens });

    expect(isRetired).toBe(false);
    const warnings = warningsOf(watch);
    expect(warnings).toHaveLength(3);
    expect(warnings.slice(0, 2).every((line) => line.includes('EIO: i/o error'))).toBe(true);
    expect(warnings[2]).toBe(notRetiredOf('stored'));
  });

  it('still says the token is retired when only removing the stored copy fails', () => {
    const { fileSystem } = makeStore();
    const refusals = makeRefusals(fileSystem);
    const { watch, token } = sentFrom('stored');
    const bankTokens = makeStore(new FakeFileSystem()).store;
    const readOnly = fail('EROFS');
    vi.spyOn(bankTokens, 'removeMatching').mockReturnValue(readOnly);

    const isRetired = retireRefusedToken(watch, failedWith('GENERIC'), { bankTokens, refusedTokens: refusals });

    expect(isRetired).toBe(true);
    expect(isRefused(refusals, token)).toBe(true);
    expect(warningsOf(watch)).toEqual(['  ⚠️  EROFS', retiredOf('stored')]);
  });

  it('never logs the token or its digest', () => {
    const { store, fileSystem } = makeStore();
    const refusals = makeRefusals(fileSystem);
    const { watch, token } = sentFrom('stored');
    storeToken(fileSystem, token);

    retireRefusedToken(watch, failedWith('GENERIC'), { bankTokens: store, refusedTokens: refusals });

    const logged = everythingLogged(watch);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(tokenDigest(token));
  });
});
