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
import { adaptFail, STAGE_SCRAPE } from './Shared.js';

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
  if (isFail(wrapped)) return adaptFail(wrapped, STAGE_SCRAPE);
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
  const message = describeScrapeFailure(result);
  return fail(message, {
    status: STAGE_SCRAPE, error: new Error(message),
  });
}

/**
 * Builds the quarantine message, keeping the provider's error TYPE attached.
 *
 * The provider splits a failure into a machine-readable `errorType` and free
 * prose in `errorMessage`. Downstream, TelegramCommandFormatters derives
 * operator advice from the quarantine entry's message alone, so a type that is
 * dropped here can never be matched — every code-keyed advice entry became
 * unreachable, and a bare `GENERIC` failure reached the user with no guidance.
 *
 * The type is prefixed rather than appended so it survives the 80-character
 * truncation the Telegram formatter applies, and is skipped when the provider
 * already spelled it out (scraper 8.6.9 front-loads its own codes, e.g.
 * `INIT_ERROR_DOCUMENT: ...`) so the text is never stuttered.
 * @param result - Failed provider result to describe.
 * @returns Message carrying both the error type and the provider's prose.
 */
function describeScrapeFailure(result: IScraperScrapingResult): string {
  const detail = result.errorMessage ?? 'Scrape failed';
  const errorType = result.errorType;
  if (errorType === undefined) return detail;
  if (detail.includes(errorType)) return detail;
  return `${errorType}: ${detail}`;
}
