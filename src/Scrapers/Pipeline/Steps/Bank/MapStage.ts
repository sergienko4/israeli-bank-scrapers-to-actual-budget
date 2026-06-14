/**
 * Stage 2: canonicalize the legacy scrape result via the mapper.
 *
 * Translates the provider-native IScraperScrapingResult into the
 * pipeline's canonical ICanonicalScrapeResult. Adapter for the
 * mapper service so the orchestrator never depends on the mapper
 * shape directly.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import type { ICanonicalScrapeResult, Procedure } from '../../Index.js';
import { fail, isFail } from '../../Index.js';
import type { IBankOpts } from './Shared.js';
import { STAGE_MAP } from './Shared.js';

/**
 * Canonicalizes the legacy scrape result via the mapper.
 * @param opts - Per-bank opts.
 * @param scrape - Legacy provider result.
 * @returns Procedure&lt;ICanonicalScrapeResult&gt; stamped STAGE_MAP on fail.
 */
export default function mapStage(
  opts: IBankOpts, scrape: IScraperScrapingResult,
): Procedure<ICanonicalScrapeResult> {
  const result = opts.ctx.services.scrapeResultMapper.legacyToCanonical({
    legacy: scrape,
    bankName: opts.entry.bankName,
    bankConfig: opts.entry.bankConfig,
  });
  if (isFail(result)) {
    const error = result.error ?? new Error(result.message);
    return fail(result.message, { status: STAGE_MAP, error });
  }
  return result;
}
