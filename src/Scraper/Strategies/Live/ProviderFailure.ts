/**
 * Provider failure classification for the live scrape retry loop.
 *
 * israeli-bank-scrapers reports a failed scrape by RESOLVING with
 * `{ success: false, errorType, errorMessage }` rather than by throwing. Our
 * retry strategy only counts an attempt as failed when the callback throws, so
 * every provider failure was reported as `Attempt 1/3` and then stopped at one
 * — the remaining attempts were never run.
 *
 * This module converts a transient provider failure into a throw so the retry
 * strategy can do its job, while letting permanent failures (a wrong password,
 * a blocked account, a landing page that no longer exists) fail fast: retrying
 * those wastes minutes of browser time and can lock the customer out.
 * @internal
 */

import { type IScraperScrapingResult, ScraperErrorTypes } from '@sergienko4/israeli-bank-scrapers';

import { PRE_REQUEST_VALIDATION_PATTERN } from '../../../Errors/ScraperErrorMessages.js';

/**
 * Failures that another attempt cannot fix.
 *
 * These use the provider's exported `ScraperErrorTypes`, so a renamed member
 * fails at compile time and a changed wire value follows the package.
 *
 * INVALID_OTP stays permanent here so this classifier returns it unchanged.
 * AttemptRunner then recognizes it and requests a fresh code; a blind retry
 * with the same rejected digits would defeat that flow.
 */
const PERMANENT_ERROR_TYPES: ReadonlySet<ScraperErrorTypes> = new Set<ScraperErrorTypes>([
  ScraperErrorTypes.InvalidPassword,
  ScraperErrorTypes.ChangePassword,
  ScraperErrorTypes.AccountBlocked,
  ScraperErrorTypes.InvalidOtp,
  ScraperErrorTypes.InvalidPhoneNumber,
  ScraperErrorTypes.TwoFactorRetrieverMissing,
]);

/**
 * Matches the INIT failure the provider reports for a landing page that does
 * not exist.
 *
 * The provider treats HTTP 404 and 410 on the landing navigation as terminal
 * — its own wording is "no later phase can recover from it" — but still
 * surfaces them under the catch-all GENERIC type, which this gate otherwise
 * treats as transient. Each pointless retry costs a full browser launch and
 * navigation for an outcome that cannot change.
 *
 * Matching the message rather than the type is deliberate: it keeps genuinely
 * transient GENERIC failures (timeouts, network blips) retryable. Should the
 * provider ever reword this text, the match stops firing and the failure falls
 * back to being retried — a reword degrades this optimisation instead of
 * breaking a scrape.
 */
const TERMINAL_LANDING_MESSAGE =
  /bank edge served HTTP (?:404|410) for the landing document/u;

/**
 * Reports whether the provider failed because the landing document is gone.
 * @param result - Provider result reporting the failure.
 * @returns True when the bank edge served a terminal 404 or 410.
 */
function isTerminalLanding(result: IScraperScrapingResult): boolean {
  return TERMINAL_LANDING_MESSAGE.test(result.errorMessage ?? '');
}

/**
 * Reports whether the provider refused its input before any bank request.
 *
 * <p>Scraper 10.1.0 validates options and credentials at its public boundary
 * and returns `GENERIC` naming only the field. Another attempt sends the same
 * value, so a retry cannot change the outcome.
 * @param result - Provider result reporting the failure.
 * @returns True for a pre-request validation failure.
 */
function isPreRequestValidation(result: IScraperScrapingResult): boolean {
  if (result.success || result.errorType !== ScraperErrorTypes.Generic) return false;
  return PRE_REQUEST_VALIDATION_PATTERN.test(result.errorMessage ?? '');
}

/**
 * Builds the message shown in retry logs for a provider failure.
 * @param result - Provider result reporting the failure.
 * @returns Error text from the provider, or a typed fallback.
 */
function describeFailure(result: IScraperScrapingResult): string {
  const detail = result.errorMessage ?? '';
  if (detail !== '') return detail;
  const label = result.errorType ?? 'an unknown error';
  return `Provider reported ${label}`;
}

/**
 * Carries a provider failure through the retry strategy's throw contract.
 *
 * The provider result is preserved verbatim so that, once retries are
 * exhausted, the caller can return the bank's own error text unchanged
 * instead of a synthesised message.
 */
export class RetryableProviderFailure extends Error {
  /** Provider result that caused this attempt to be retried. */
  public readonly result: IScraperScrapingResult;

  /**
   * Wraps a transient provider failure so the retry strategy observes a throw.
   * @param result - Provider result reporting the transient failure.
   */
  constructor(result: IScraperScrapingResult) {
    const summary = describeFailure(result);
    super(summary);
    this.name = 'RetryableProviderFailure';
    this.result = result;
  }
}

/**
 * Reports whether another attempt could plausibly succeed.
 * @param result - Provider result returned by israeli-bank-scrapers.
 * @returns True when the failure is transient and worth retrying.
 */
export function isRetryableProviderFailure(result: IScraperScrapingResult): boolean {
  if (result.success) return false;
  if (isTerminalLanding(result)) return false;
  if (isPreRequestValidation(result)) return false;
  if (result.errorType === undefined) return true;
  return !PERMANENT_ERROR_TYPES.has(result.errorType);
}

/**
 * Converts a transient provider failure into a throw for the retry strategy.
 * @param result - Provider result returned by israeli-bank-scrapers.
 * @returns The result unchanged when it must not be retried.
 * @throws {RetryableProviderFailure} When another attempt could succeed.
 */
export function throwIfRetryable(result: IScraperScrapingResult): IScraperScrapingResult {
  if (!isRetryableProviderFailure(result)) return result;
  throw new RetryableProviderFailure(result);
}
