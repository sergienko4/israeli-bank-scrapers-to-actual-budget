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
  ICanonicalScrapeResult, IRawScrape, ISignPolicy,
} from '../../Types/Index.js';

/** Inputs to IScrapeResultMapper.mapToCanonical. */
export interface IMapToCanonicalOpts {
  readonly raw: IRawScrape;
  readonly signPolicy: ISignPolicy;
  readonly startDate: Date;
  readonly endDate: Date;
}

/** Mapper contract for raw → canonical → legacy conversions. */
export interface IScrapeResultMapper {
  mapToCanonical(opts: IMapToCanonicalOpts): ICanonicalScrapeResult;
  canonicalToLegacy(
    canonical: ICanonicalScrapeResult, originalRaw: IScraperScrapingResult,
  ): IScraperScrapingResult;
}
