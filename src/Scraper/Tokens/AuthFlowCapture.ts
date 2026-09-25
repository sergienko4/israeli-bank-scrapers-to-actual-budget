/**
 * Captures the durable long-term token API-direct banks mint.
 *
 * <p>OneZero, Pepper and PayBox return a long-lived re-login token after a
 * successful SMS login. The provider redacts it from its own logs, so a token
 * not captured here is never available to anyone.
 *
 * <p>Two capture points cover different failures. `onAuthFlowComplete` fires
 * the moment login succeeds, including when the provider logs in again
 * mid-run because the bank rejected the session; a scrape that fails after
 * that point would otherwise lose the new token. The result's
 * `persistentOtpToken` is the backstop for any path that fills the field
 * without firing the callback.
 *
 * <p>A store that cannot be written costs a warning, never the scrape. Neither
 * the token nor the session bearer is ever logged.
 */

import type { IScraperScrapingResult, ScraperOptions } from '@sergienko4/israeli-bank-scrapers';
import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';

import type { ILogger } from '../../Logger/ILogger.js';
import type { ISweepReport } from '../../Storage/StoreTypes.js';
import { errorMessage } from '../../Utils/Index.js';
import { NO_TOKEN } from './BankTokenRecords.js';
import type { IBankTokenStore } from './BankTokenStore.js';

/**
 * Banks whose login mints a durable long-term token.
 *
 * <p>Built from the `CompanyTypes` enum rather than string literals: the enum
 * values are camelCase (`payBox`), and a hand-written `PayBox` would never
 * match.
 */
const API_DIRECT_BANKS: ReadonlySet<string> = new Set<string>([
  CompanyTypes.OneZero, CompanyTypes.Pepper, CompanyTypes.PayBox,
]);

/** Provider callback invoked once an API-direct login completes. */
type AuthFlowHook = NonNullable<ScraperOptions['onAuthFlowComplete']>;

/** What the provider hands that callback. */
type IAuthFlowPayload = Parameters<AuthFlowHook>[0];

/** Provider options subset that accepts the login-complete callback. */
export interface IAuthFlowHookTarget {
  onAuthFlowComplete?: AuthFlowHook;
}

/** Everything a capture needs to store and report one account's token. */
export interface IAuthFlowCaptureParams {
  /** The account's key in the store, built by {@link buildTokenStoreKey}. */
  readonly storeKey: string;
  readonly companyType: string;
  readonly store: IBankTokenStore;
  readonly logger: ILogger;
}

/**
 * Builds the store key for one configured account.
 *
 * <p>The registry matches aliases case-insensitively, so the entries `oneZero`
 * and `onezero` both resolve to `onezero`. Keyed on the bank alone, two
 * accounts would share one token, and since every login revokes the token
 * before it, both would need an SMS on every run. The config entry name tells
 * them apart; renaming the entry orphans its token, which costs one SMS.
 *
 * <p>The name is used verbatim. The registry trims it before matching, so
 * `oneZero` and `oneZero ` are also one bank; trimming here would put them on
 * one key.
 * @param bankId - Canonical bank id resolved from the registry.
 * @param accountKey - Name of the `banks` config entry, when known.
 * @returns `bankId:accountKey`, or `bankId` when the entry name is blank.
 */
export function buildTokenStoreKey(bankId: string, accountKey = ''): string {
  if (accountKey.trim().length === 0) return bankId;
  return `${bankId}:${accountKey}`;
}

/**
 * Tells whether a bank's login mints a durable long-term token.
 * @param companyType - Provider company id of the bank being scraped.
 * @returns True for OneZero, Pepper and PayBox.
 */
export function isApiDirectBank(companyType: string): boolean {
  return API_DIRECT_BANKS.has(companyType);
}

/**
 * Warns that something the store was asked to do did not happen.
 * @param params - Capture parameters carrying the logger.
 * @param message - What failed and why, naming the account but not the token.
 * @returns False, so callers can report the outcome in one step.
 */
function warnOf(params: IAuthFlowCaptureParams, message: string): false {
  params.logger.warn(`  ⚠️  ${message}`);
  return false;
}

/**
 * Persists one captured token, turning any failure into a warning.
 *
 * <p>The store owns the rules for what is written: it skips a blank token and
 * one it already holds, so both the callback and the backstop can hand it
 * whatever they received.
 * @param token - The long-term token the provider returned.
 * @param params - Account key, store and logger for this capture.
 * @returns True when the file now holds a token it did not hold before.
 */
function persistToken(token: string, params: IAuthFlowCaptureParams): boolean {
  try {
    const result = params.store.write(params.storeKey, token);
    if (!result.success) return warnOf(params, result.message);
    if (result.data.written) {
      params.logger.info(`  🔐 Stored the long-term token for ${params.storeKey}`);
    }
    return result.data.written;
  } catch (error: unknown) {
    const detail = errorMessage(error);
    return warnOf(params, `Could not store the long-term token for ${params.storeKey}: ${detail}`);
  }
}

/**
 * Builds the provider callback that persists a completed login's token.
 *
 * <p>Tokens arrive in the order they were minted, so each write replaces the
 * previous token with a newer one. Every login revokes the token before it,
 * and the attempt runner never lets two logins of one attempt overlap: an
 * attempt that captures tokens runs a single try, so a scrape the timeout
 * abandoned is the only login, and its late callback stores the token the
 * bank still honours.
 * @param params - Account key, store and logger for this capture.
 * @returns Callback the provider invokes once its login completes.
 */
function buildCaptureHook(params: IAuthFlowCaptureParams): AuthFlowHook {
  return (info: IAuthFlowPayload): ReturnType<AuthFlowHook> => {
    persistToken(info.longTermToken, params);
    return Promise.resolve();
  };
}

/**
 * Registers the token capture on the provider options of an API-direct bank.
 * @param target - Provider options that receive the callback.
 * @param params - Account key, store and logger for this capture.
 * @returns True when the callback was attached; browser banks never mint one.
 */
export function attachAuthFlowCapture(
  target: IAuthFlowHookTarget, params: IAuthFlowCaptureParams,
): boolean {
  if (!isApiDirectBank(params.companyType)) return false;
  target.onAuthFlowComplete = buildCaptureHook(params);
  return true;
}

/**
 * Persists the durable token a provider result carried.
 *
 * <p>The provider fills `persistentOtpToken` only on a successful result
 * today; a token minted before a failure reaches the store through the login
 * callback. A failed result that does carry one is stored as well, since a
 * minted token has already revoked the one before it.
 * @param result - Provider result of one attempt.
 * @param params - Account key, store and logger for this capture.
 * @returns True when a new token was persisted.
 */
export function captureResultToken(
  result: IScraperScrapingResult, params: IAuthFlowCaptureParams,
): boolean {
  if (!isApiDirectBank(params.companyType)) return false;
  return persistToken(result.persistentOtpToken ?? NO_TOKEN, params);
}

/**
 * Reports a sweep that removed something, staying silent when it did not.
 * @param report - What the sweep did.
 * @param params - Capture parameters carrying the logger.
 * @returns True, since the sweep ran.
 */
function reportSwept(report: ISweepReport, params: IAuthFlowCaptureParams): true {
  if (report.removedCount > 0) params.logger.info(`  🧹 ${report.summary} beside the token store`);
  return true;
}

/** What a failed sweep warns, ahead of the cause. */
const SWEEP_FAILED = 'Could not sweep staged token files';

/**
 * Deletes staged token files a killed run left behind, before an API-direct scrape.
 *
 * <p>Each leftover holds a live credential. Every import runs in its own
 * process, so sweeping when an API-direct scrape starts covers every run that
 * can stage one. Browser banks never touch the store, so their runs skip it.
 * @param params - Account key, store and logger for this scrape.
 * @returns True when the sweep ran; a failure is a warning, never an error.
 */
export function sweepTokenLeftovers(params: IAuthFlowCaptureParams): boolean {
  if (!isApiDirectBank(params.companyType)) return false;
  try {
    const swept = params.store.sweepStagedLeftovers();
    if (!swept.success) return warnOf(params, `${SWEEP_FAILED}: ${swept.message}`);
    return reportSwept(swept.data, params);
  } catch (error: unknown) {
    const detail = errorMessage(error);
    return warnOf(params, `${SWEEP_FAILED}: ${detail}`);
  }
}
