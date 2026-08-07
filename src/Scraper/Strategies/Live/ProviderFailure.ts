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
 * a blocked account) fail fast: retrying those wastes minutes of browser time
 * and can lock the customer out.
 * @internal
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

/**
 * Failures that another attempt cannot fix.
 *
 * These mirror the upstream `ScraperErrorTypes` string values. The enum is
 * declared but not exported as a value by the provider package, so the wire
 * strings are matched directly.
 *
 * INVALID_OTP is absent on purpose: it has a dedicated re-prompt path in
 * AttemptRunner that asks the user for a fresh code, which a blind retry with
 * the same rejected digits would defeat.
 */
const PERMANENT_ERROR_TYPES = new Set<string>([
  'INVALID_PASSWORD',
  'CHANGE_PASSWORD',
  'ACCOUNT_BLOCKED',
  'INVALID_OTP',
  'TWO_FACTOR_RETRIEVER_MISSING',
]);

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
  const errorType = String(result.errorType);
  return !PERMANENT_ERROR_TYPES.has(errorType);
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
