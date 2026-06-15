/**
 * Canonical scrape result types.
 *
 * Phase-2 contract consumed by phase-3 to decouple downstream importers
 * from the raw provider schema (@sergienko4/israeli-bank-scrapers).
 * BankScraper currently exposes a legacy adapter back to
 * IScraperScrapingResult for backward compatibility; phase-3 switches
 * all consumers to ICanonicalScrapeResult directly.
 */

import type {
  CompanyTypes,
  IScraperScrapingResult,
} from '@sergienko4/israeli-bank-scrapers';

import type { IBankTransaction } from '../Bank.js';

/** Sign-handling policy applied by the mapper for a given bank. */
export type ISignPolicy = 'flip-credit' | 'preserve';

/** Type of scrape strategy that produced a result. */
export type IScrapeStrategyKind = 'live' | 'mock';

/** Account-level canonical record produced by the mapper. */
export interface ICanonicalAccount {
  readonly accountNumber: string;
  readonly balance: number | null;
  readonly txns: readonly IBankTransaction[];
}

/** Execution metadata captured by the mapper for observability. */
export interface ICanonicalScrapeMetadata {
  readonly startDate: string;
  readonly endDate: string;
  readonly signPolicyApplied: ISignPolicy;
  readonly strategy: IScrapeStrategyKind;
  readonly attemptCount: number;
}

/** Canonical scrape result returned by BankScraper internally. */
export interface ICanonicalScrapeResult {
  readonly bankId: string;
  readonly scrapedAt: string;
  readonly accounts: readonly ICanonicalAccount[];
  readonly metadata: ICanonicalScrapeMetadata;
}

/** Raw scrape payload returned by a scrape strategy before mapping. */
export interface IRawScrape {
  readonly bankId: string;
  /** Optional — absent when the strategy operates on an unregistered bank (e.g. mock fixtures). */
  readonly companyType?: CompanyTypes;
  readonly attemptCount: number;
  readonly strategy: IScrapeStrategyKind;
  readonly raw: IScraperScrapingResult;
}
