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
import { isFail } from '../../Index.js';
import type { IBankOpts } from './Shared.js';
import { adaptFail, STAGE_MAP } from './Shared.js';

/** Args passed to the mapper service's `legacyToCanonical`. */
interface IMapArgs {
  readonly legacy: IScraperScrapingResult;
  readonly bankName: string;
  readonly bankConfig: IBankOpts['entry']['bankConfig'];
}

/**
 * Canonicalizes the legacy scrape result via the mapper.
 * @param opts - Per-bank opts.
 * @param scrape - Legacy provider result.
 * @returns Procedure&lt;ICanonicalScrapeResult&gt; stamped STAGE_MAP on fail.
 */
export default function mapStage(
  opts: IBankOpts, scrape: IScraperScrapingResult,
): Procedure<ICanonicalScrapeResult> {
  const args = buildMapArgs(opts, scrape);
  const result = opts.ctx.services.scrapeResultMapper
    .legacyToCanonical(args);
  if (isFail(result)) return adaptFail(result, STAGE_MAP);
  return result;
}

/**
 * Builds the mapper args object for legacyToCanonical.
 * @param opts - Per-bank opts (provides bankName + bankConfig).
 * @param scrape - Legacy provider result threaded as `legacy`.
 * @returns Frozen IMapArgs ready for the mapper service.
 */
function buildMapArgs(
  opts: IBankOpts, scrape: IScraperScrapingResult,
): IMapArgs {
  return Object.freeze({
    legacy: scrape,
    bankName: opts.entry.bankName,
    bankConfig: opts.entry.bankConfig,
  });
}
