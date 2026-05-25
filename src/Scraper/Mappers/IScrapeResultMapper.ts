/**
 * Contract for mapping raw provider scrape payloads into the canonical
 * ICanonicalScrapeResult shape used by downstream importers (phase-3).
 *
 * The mapper is the single owner of:
 *   - Sign-policy application (delegated from BankScraper)
 *   - Account/transaction shape normalization
 *   - Legacy back-adapter to IScraperScrapingResult (removed in phase-3)
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import type {
  IBankConfig, ICanonicalScrapeResult, IRawScrape, ISignPolicy, Procedure,
} from '../../Types/Index.js';

/** Inputs to IScrapeResultMapper.mapToCanonical. */
export interface IMapToCanonicalOpts {
  readonly raw: IRawScrape;
  readonly signPolicy: ISignPolicy;
  readonly startDate: Date;
  readonly endDate: Date;
}

/** Inputs to IScrapeResultMapper.legacyToCanonical (phase-3 boundary). */
export interface ILegacyToCanonicalOpts {
  readonly legacy: IScraperScrapingResult;
  readonly bankName: string;
  readonly bankConfig: IBankConfig;
}

/** Mapper contract for raw → canonical → legacy conversions. */
export interface IScrapeResultMapper {
  mapToCanonical(opts: IMapToCanonicalOpts): ICanonicalScrapeResult;
  canonicalToLegacy(
    canonical: ICanonicalScrapeResult, originalRaw: IScraperScrapingResult,
  ): IScraperScrapingResult;
  /**
   * Converts a legacy provider result (already sign-normalized by BankScraper)
   * into the canonical shape consumed by phase-3 downstream importers.
   * Returns Procedure so the pipeline can quarantine map failures.
   */
  legacyToCanonical(opts: ILegacyToCanonicalOpts): Procedure<ICanonicalScrapeResult>;
}
