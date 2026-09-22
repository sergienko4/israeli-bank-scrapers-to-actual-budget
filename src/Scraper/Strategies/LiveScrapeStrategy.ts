/**
 * LiveScrapeStrategy — public facade for the live scraper cluster.
 *
 * The implementation lives under Live/ so the exported strategy remains
 * stable while the provider setup, OTP, and retry concerns stay isolated.
 */

import type { IRawScrape, Procedure } from '../../Types/Index.js';
import type {
  IBankScrapeStrategy,
  IBankScrapeStrategyOpts,
} from './IBankScrapeStrategy.js';
import { runLiveScrape } from './Live/Index.js';
import type { ILiveScrapeDependencies } from './Live/Types.js';

/**
 * Constructor options for the live scrape strategy.
 *
 * Aliases the internal dependency contract rather than restating it: the two
 * lists were already identical field for field, so a second copy could only
 * ever drift out of step with the one the helpers actually consume.
 */
export type ILiveScrapeStrategyOpts = ILiveScrapeDependencies;

/** Strategy driving the real israeli-bank-scrapers package. */
export class LiveScrapeStrategy implements IBankScrapeStrategy {
  /**
   * Creates a LiveScrapeStrategy with the given resilience + notification deps.
   * @param opts - Injected collaborators captured by closure.
   */
  constructor(private readonly opts: ILiveScrapeStrategyOpts) {}

  /**
   * Performs a live scrape with one-shot OTP retry on INVALID_OTP failures.
   * @param scrapeOpts - Inputs from the BankScraper coordinator.
   * @returns Procedure success with the raw scrape, including attemptCount.
   */
  public scrape(scrapeOpts: IBankScrapeStrategyOpts): Promise<Procedure<IRawScrape>> {
    return runLiveScrape(this.opts, scrapeOpts);
  }
}
