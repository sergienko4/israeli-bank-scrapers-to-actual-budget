/**
 * Stage 1: scrape one bank via the resilience-wrapped client.
 *
 * Adapts the legacy provider error surface into a Procedure outcome
 * stamped with STAGE_SCRAPE so quarantine entries are correctly
 * labeled. Preserves the original Error reference end-to-end (INV-3).
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import type { Procedure } from '../../Index.js';
import { fail, fromPromise, isFail, succeed } from '../../Index.js';
import type { IBankOpts } from './Shared.js';
import { STAGE_SCRAPE } from './Shared.js';

/**
 * Scrapes via resilience-wrapped call and adapts errors to Procedure.
 * @param opts - Per-bank opts.
 * @returns Procedure&lt;IScraperScrapingResult&gt; stamped STAGE_SCRAPE on fail.
 */
export default async function scrapeStage(
  opts: IBankOpts,
): Promise<Procedure<IScraperScrapingResult>> {
  const scrapePromise = opts.ctx.services.bankScraper
    .scrapeBankWithResilience(opts.entry.bankName, opts.entry.bankConfig);
  const wrapped = await fromPromise(scrapePromise, 'Scrape failed');
  if (isFail(wrapped)) {
    const error = wrapped.error ?? new Error(wrapped.message);
    return fail(wrapped.message, { status: STAGE_SCRAPE, error });
  }
  return checkScrapeSuccess(wrapped.data);
}

/**
 * Promotes provider `.success` boolean into a Procedure outcome.
 * @param result - Legacy IScraperScrapingResult from the scraper.
 * @returns succeed on success, fail STAGE_SCRAPE otherwise.
 */
function checkScrapeSuccess(
  result: IScraperScrapingResult,
): Procedure<IScraperScrapingResult> {
  if (result.success) return succeed(result);
  const message = result.errorMessage ?? 'Scrape failed';
  return fail(message, {
    status: STAGE_SCRAPE, error: new Error(message),
  });
}
