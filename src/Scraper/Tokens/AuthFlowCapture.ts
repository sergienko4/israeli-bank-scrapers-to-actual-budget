/**
 * Captures the durable long-term token API-direct banks mint.
 *
 * <p>OneZero, Pepper and PayBox hand back a long-lived re-login artifact after
 * a successful SMS login; replaying it on the next run skips the SMS entirely.
 * Provider 8.7.2 redacts that value from its own logs, so a caller that does
 * not capture it programmatically can never obtain it — and pays for an SMS on
 * every run forever.
 *
 * <p>Two capture points exist because they cover different failures. The
 * `onAuthFlowComplete` callback fires the moment login succeeds, including the
 * in-request repair the provider performs when a warm session is revoked
 * mid-run; a scrape that fails after that point would otherwise lose the
 * replacement token. The scrape result is the backstop for any path that
 * populates the public field without firing the callback.
 *
 * <p>Neither the token nor the session bearer is ever logged. Both are
 * credentials: the token is a standing bypass of the second factor, and the
 * repository's logging rules deny credential material by default.
 */

import type { IScraperScrapingResult, ScraperOptions } from '@sergienko4/israeli-bank-scrapers';
import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';

import type { ILogger } from '../../Logger/ILogger.js';
import { errorMessage } from '../../Utils/Index.js';
import type { IBankTokenStore } from './BankTokenStore.js';

/**
 * Banks whose login chain mints a durable long-term token.
 *
 * <p>Built from the `CompanyTypes` enum rather than string literals: the enum
 * values are camelCase (`payBox`), so a hand-written PascalCase literal would
 * silently never match and the capture would quietly stop happening.
 */
export const API_DIRECT_BANKS: ReadonlySet<string> = new Set<string>([
  CompanyTypes.OneZero, CompanyTypes.Pepper, CompanyTypes.PayBox,
]);

/** Provider lifecycle callback invoked once an API-direct auth flow completes. */
type AuthFlowHook = NonNullable<ScraperOptions['onAuthFlowComplete']>;

/** The provider payload delivered once an API-direct auth flow completes. */
type IAuthFlowPayload = Parameters<AuthFlowHook>[0];

/** Provider options subset that accepts the auth-flow completion callback. */
export interface IAuthFlowHookTarget {
  onAuthFlowComplete?: AuthFlowHook;
}

/** Everything a capture needs to identify, store and report one bank's token. */
export interface IAuthFlowCaptureParams {
  /** Canonical bank id, used only in operator-facing messages. */
  readonly bankId: string;
  /** Store key isolating this login identity; built by `buildTokenStoreKey`. */
  readonly storeKey: string;
  readonly companyType: string;
  readonly store: IBankTokenStore;
  readonly logger: ILogger;
}

/**
 * Builds the token store key for one configured account.
 *
 * <p>`bankId` alone is not unique per login identity: the registry resolves
 * aliases case-insensitively, so the config entries `oneZero` and `onezero`
 * both yield `onezero`. Two real accounts sharing one slot would replay each
 * other's token, fail the warm start, and re-mint — and every mint revokes
 * the token it replaces, so both accounts would need an SMS on every run.
 *
 * <p>The config entry name is the account identity because it is stable,
 * unique by construction and contains no secret. Renaming the entry orphans
 * the stored token, which costs exactly one SMS to re-establish.
 * @param bankId - Canonical bank id resolved from the registry.
 * @param accountKey - Name of the `banks` config entry, when known.
 * @returns A key unique to this bank and configured account.
 */
export function buildTokenStoreKey(bankId: string, accountKey?: string): string {
  const account = accountKey?.trim() ?? '';
  if (account.length === 0) return bankId;
  return `${bankId}:${account}`;
}

/**
 * Indicates whether a bank can warm-start from a stored long-term token.
 * @param companyType - Provider company id for the bank being scraped.
 * @returns True when the bank's login chain mints a durable token.
 */
export function isApiDirectBank(companyType: string): boolean {
  return API_DIRECT_BANKS.has(companyType);
}

/**
 * Persists one captured token, converting any failure into a warning.
 *
 * <p>A store that cannot be written costs the next run an SMS; it must never
 * cost this run its transactions, so the failure is reported and swallowed.
 * @param token - The long-term token to persist; blank values are ignored.
 * @param params - Bank identity, store and logger for this capture.
 * @returns True when a token was persisted.
 */
function persistToken(token: string, params: IAuthFlowCaptureParams): boolean {
  if (token.length === 0) return false;
  try {
    const result = params.store.write(params.storeKey, token);
    if (result.success) return result.data.written;
    warnNotStored(params, result.message);
    return false;
  } catch (error: unknown) {
    const detail = errorMessage(error);
    warnNotStored(params, detail);
    return false;
  }
}

/**
 * Warns that a token could not be stored, keeping the underlying cause.
 *
 * <p>The cause is the whole value of the warning: the likeliest failure is a
 * read-only or full data volume, and `EROFS`/`ENOSPC` is exactly what tells
 * an operator which one it is. Dropping it leaves them a message that says
 * something went wrong and nothing they can act on.
 * @param params - Bank identity and logger for this capture.
 * @param detail - Underlying reason the write failed.
 * @returns True once the warning has been emitted.
 */
function warnNotStored(params: IAuthFlowCaptureParams, detail: string): boolean {
  params.logger.warn(
    `  ⚠️  Could not store the long-term token for ${params.bankId}: ${detail}`
    + ' — the next run will need another SMS',
  );
  return true;
}

/**
 * Builds the provider callback that persists a completed auth flow's token.
 *
 * <p>The last capture to arrive wins, deliberately. A scrape the timeout
 * abandoned keeps running, so its hook can fire after a later attempt has
 * already stored a token. Minting revokes the previous token, and upstream
 * invokes this callback the moment the auth flow completes, so arrival order
 * tracks mint order: the token that lands last is the one the bank still
 * honours. Refusing a write from a superseded attempt would therefore keep a
 * token that attempt had already revoked, and cost the next run an SMS.
 *
 * <p>The ordering holds only while the process is alive. A hook that has not
 * fired by the time the run ends is lost, and its token with it. The store is
 * then left holding a token the mint already revoked, so the state is worse
 * than before the run — but the cost of that state is one SMS on the next
 * run, which is the same cost as never having captured anything. Waiting for
 * a hook that may never fire would buy back that one SMS at the price of a
 * run that cannot be relied on to end, which is the worse trade.
 * @param params - Bank identity, store and logger for this capture.
 * @returns Callback the provider invokes once its auth flow completes.
 */
function buildCaptureHook(params: IAuthFlowCaptureParams): AuthFlowHook {
  return (info: IAuthFlowPayload): ReturnType<AuthFlowHook> => {
    const isStored = persistToken(info.longTermToken, params);
    if (isStored) {
      params.logger.info(
        `  🔐 Stored the long-term token for ${params.bankId} — next run skips the SMS`,
      );
    }
    return Promise.resolve();
  };
}

/**
 * Registers the token capture on the provider options for eligible banks.
 *
 * <p>Browser banks are left untouched: they never produce a durable token, so
 * attaching the hook would only add a callback that can never fire.
 * @param target - Provider options object that receives the callback.
 * @param params - Bank identity, store and logger for this capture.
 * @returns True when the capture hook was attached.
 */
export function attachAuthFlowCapture(
  target: IAuthFlowHookTarget, params: IAuthFlowCaptureParams,
): boolean {
  if (!isApiDirectBank(params.companyType)) return false;
  target.onAuthFlowComplete = buildCaptureHook(params);
  return true;
}

/**
 * Persists the durable token a successful scrape result carried.
 *
 * <p>Acts as the backstop for the callback, and asks only whether a token is
 * present — not whether the scrape as a whole succeeded. A token that exists
 * has already been minted, which revoked the one before it, so discarding it
 * because the run failed later would leave the store holding a dead token
 * and cost the next run an SMS. The provider does not currently attach a
 * token to a failure result, so this is belt-and-braces rather than a path
 * in use; it is written this way so the behaviour does not depend on that.
 *
 * <p>Deduplication is left to the store rather than short-circuited here,
 * which keeps the "have I seen this token" rule in one place.
 * @param result - Provider scrape result to inspect.
 * @param params - Bank identity, store and logger for this capture.
 * @returns True when a new token was persisted.
 */
export function captureResultToken(
  result: IScraperScrapingResult, params: IAuthFlowCaptureParams,
): boolean {
  if (!isApiDirectBank(params.companyType)) return false;
  const token = result.persistentOtpToken ?? '';
  if (token.length === 0) return false;
  return persistToken(token, params);
}
