/**
 * Stage 2: canonicalize the legacy scrape result via the mapper.
 *
 * Translates the provider-native IScraperScrapingResult into the
 * pipeline's canonical ICanonicalScrapeResult. Adapter for the
 * mapper service so the orchestrator never depends on the mapper
 * shape directly.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import type { ICanonicalScrapeResult, ISignPolicy, Procedure } from '../../Index.js';
import { isFail, isSuccess } from '../../Index.js';
import type { IBankOpts } from './Shared.js';
import { adaptFail, STAGE_MAP } from './Shared.js';

/** Args passed to the mapper service's `legacyToCanonical`. */
interface IMapArgs {
  readonly legacy: IScraperScrapingResult;
  readonly bankName: string;
  readonly bankConfig: IBankOpts['entry']['bankConfig'];
  readonly signPolicy: ISignPolicy;
}

/**
 * Resolves the sign policy for a bank via the injected registry,
 * falling back to 'preserve' for unknown banks (matches
 * BankScraper.mapAndAdapt's forward-path fallback).
 * @param opts - Per-bank opts (provides ctx.services.bankRegistry + entry).
 * @returns Resolved ISignPolicy or 'preserve' default.
 */
function resolveSignPolicy(opts: IBankOpts): ISignPolicy {
  const resolved = opts.ctx.services.bankRegistry.resolve(opts.entry.bankName);
  if (isSuccess(resolved)) return resolved.data.signPolicy;
  return 'preserve';
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
 * @param opts - Per-bank opts (provides bankName + bankConfig + registry).
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
    signPolicy: resolveSignPolicy(opts),
  });
}
