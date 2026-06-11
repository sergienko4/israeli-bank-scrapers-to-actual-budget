/**
 * EmptyResultDetector — classifies scraper failures as "empty result" vs real errors.
 *
 * Banks frequently return success-shaped failures with messages like
 * "no transactions found" or "לא מצאנו תנועות" when the user has zero
 * activity in the date range. Treating these as errors would spam the
 * Telegram channel; treating them as silent successes would hide real
 * outages. This module is the single source of truth for that decision.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

const NO_RECORDS_PATTERNS = [
  'no transactions found', 'no results found', 'לא מצאנו תנועות',
] as const;

/**
 * Checks whether a scraper failure indicates "no transactions" vs. a real error.
 *
 * Case-insensitive substring match against the module-internal
 * `NO_RECORDS_PATTERNS` list. Returns false for a missing `errorMessage`
 * so callers don't classify a successful empty result as "empty error"
 * by accident.
 * @param result - The IScraperScrapingResult to inspect.
 * @returns True when the error message matches a known empty-result pattern.
 */
export default function isEmptyResultError(
  result: IScraperScrapingResult,
): boolean {
  const rawMessage = result.errorMessage ?? '';
  const msg = rawMessage.toLowerCase();
  return NO_RECORDS_PATTERNS.some(pattern => {
    const loweredPattern = pattern.toLowerCase();
    return msg.includes(loweredPattern);
  });
}
