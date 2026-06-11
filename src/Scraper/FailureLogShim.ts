/**
 * FailureLogShim — back-compat helper extracted from BankScraper.
 *
 * Hosts `logScrapeFailure`, the module-level error logger consumed by
 * AccountImporter (and tests). It uses module-level `getLogger()` rather
 * than threading an ILogger through the call site, so it cannot live on
 * the BankScraper class (which has its own injected ILogger). Splitting
 * it out shrinks BankScraper.ts's cluster-sprawl score and isolates the
 * legacy logger-coupling into one small module that Phase-3 can delete
 * once callers are migrated to inject ILogger themselves.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import { getScraperErrorAdvice } from '../Errors/ScraperErrorMessages.js';
import { getLogger } from '../Logger/Index.js';
import type { IProcedureSuccess } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';

/**
 * Logs a scraper failure with a user-friendly hint based on the error type.
 *
 * Back-compat shim — uses module-level getLogger() since callers do not
 * thread an ILogger through; phase-3 will delete and inline at call sites.
 *
 * @param bankName - Name of the bank that failed.
 * @param result - Failed IScraperScrapingResult containing error details.
 * @returns Successful Procedure indicating the failure was logged.
 */
export default function logScrapeFailure(
  bankName: string, result: IScraperScrapingResult,
): IProcedureSuccess<{ status: string }> {
  const baseMsg = result.errorMessage ?? 'Unknown error';
  const errorType = result.errorType ?? '';
  const advice = getScraperErrorAdvice(errorType);
  const hint = advice ? `. ${advice}` : '';
  getLogger().error(`  ❌ Failed to scrape ${bankName}: ${baseMsg}${hint}`);
  return succeed({ status: 'logged' });
}
