/**
 * LiveScrapeStrategy — public facade for the live scraper cluster.
 *
 * The implementation lives under Live/ so the exported strategy remains
 * stable while the provider setup, OTP, and retry concerns stay isolated.
 */

import type { IRetryStrategy } from '../../Resilience/RetryStrategy.js';
import type { ITimeoutWrapper } from '../../Resilience/TimeoutWrapper.js';
import type { ITwoFactorPrompter } from '../../Services/ITwoFactorPrompter.js';
import type NotificationService from '../../Services/NotificationService.js';
import type { IImporterConfig, IRawScrape, Procedure } from '../../Types/Index.js';
import type {
  IBankScrapeStrategy,
  IBankScrapeStrategyOpts,
} from './IBankScrapeStrategy.js';
import { runLiveScrape } from './Live/Index.js';

/** Constructor options for the live scrape strategy. */
export interface ILiveScrapeStrategyOpts {
  readonly config: IImporterConfig;
  readonly retryStrategy: IRetryStrategy;
  readonly noRetryStrategy: IRetryStrategy;
  readonly timeoutWrapper: ITimeoutWrapper;
  readonly twoFactorPrompter: ITwoFactorPrompter | null;
  readonly notificationService: NotificationService;
}

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
