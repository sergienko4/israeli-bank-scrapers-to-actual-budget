/**
 * Contract for a bank-scrape strategy.
 *
 * Implementations decide how to obtain a raw provider scrape:
 *   - LiveScrapeStrategy drives the real israeli-bank-scrapers package.
 *   - MockScrapeStrategy reads a fixture file (E2E + local tests).
 *
 * The composition root selects exactly one implementation per process,
 * eliminating the env-var reads previously buried inside BankScraper.
 */

import type { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';

import type { ILogger } from '../../Logger/ILogger.js';
import type { IBankConfig, IRawScrape, Procedure } from '../../Types/Index.js';

/** Options passed to every IBankScrapeStrategy.scrape call. */
export interface IBankScrapeStrategyOpts {
  readonly bankId: string;
  /**
   * Provider CompanyType resolved from the registry, or undefined when the
   * bank name is unknown to the registry. Mock strategies ignore it; the
   * live strategy fails with status="unknown-bank" when missing.
   */
  readonly companyType?: CompanyTypes;
  readonly bankConfig: IBankConfig;
  /**
   * Name of the `banks` config entry this scrape came from.
   *
   * <p>Distinct from `bankId`: the registry matches aliases case-insensitively,
   * so `oneZero` and `onezero` both resolve to `onezero`. Anything stored per
   * account, such as a durable login token, is keyed on this too, or two
   * accounts at one bank would share a single slot.
   */
  readonly accountKey?: string;
  readonly startDate: Date;
  readonly logger: ILogger;
  readonly otpRetriever?: () => Promise<string>;
}

/** Strategy contract — produces a raw provider scrape. */
export interface IBankScrapeStrategy {
  scrape(opts: IBankScrapeStrategyOpts): Promise<Procedure<IRawScrape>>;
}
