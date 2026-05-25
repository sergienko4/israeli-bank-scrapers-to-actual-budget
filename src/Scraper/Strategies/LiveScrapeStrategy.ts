/**
 * LiveScrapeStrategy — drives the real israeli-bank-scrapers package.
 *
 * Owns the live-scrape concerns previously embedded inside BankScraper:
 *   - createScraper() setup + browser session cleanup
 *   - ScraperOptions construction (Chrome args, OTP retriever)
 *   - Per-bank credential building
 *   - Retry strategy selection (regular vs no-retry for 2FA)
 *   - Timeout wrapping
 *   - One-shot retry on INVALID_OTP with user notification
 */

import { existsSync, rmSync } from 'node:fs';

import type {
  IScraperScrapingResult, ScraperCredentials, ScraperOptions,
} from '@sergienko4/israeli-bank-scrapers';
import { createScraper } from '@sergienko4/israeli-bank-scrapers';

import type { ILogger } from '../../Logger/ILogger.js';
import type { IRetryStrategy } from '../../Resilience/RetryStrategy.js';
import type { ITimeoutWrapper } from '../../Resilience/TimeoutWrapper.js';
import type TelegramNotifier from '../../Services/Notifications/TelegramNotifier.js';
import type NotificationService from '../../Services/NotificationService.js';
import TwoFactorService from '../../Services/TwoFactorService.js';
import type {
  IBankConfig, IImporterConfig, IRawScrape, Procedure,
} from '../../Types/Index.js';
import { DEFAULT_RESILIENCE_CONFIG, succeed } from '../../Types/Index.js';
import { errorMessage } from '../../Utils/Index.js';
import buildCredentials from '../CredentialsBuilder.js';
import { buildChromeArgs, getChromeDataDir } from '../ScraperOptionsBuilder.js';
import type {
  IBankScrapeStrategy, IBankScrapeStrategyOpts,
} from './IBankScrapeStrategy.js';

/** Constructor options for the live scrape strategy. */
export interface ILiveScrapeStrategyOpts {
  readonly config: IImporterConfig;
  readonly retryStrategy: IRetryStrategy;
  readonly noRetryStrategy: IRetryStrategy;
  readonly timeoutWrapper: ITimeoutWrapper;
  readonly telegramNotifier: TelegramNotifier | null;
  readonly notificationService: NotificationService;
}

/** Internal helper params bundle for buildOtpRetriever. */
interface IOtpRetrieverParams {
  readonly bankId: string;
  readonly bankConfig: IBankConfig;
  readonly notifier: TelegramNotifier | null;
  readonly logger: ILogger;
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
   * @returns Procedure success with the raw scrape (including attemptCount).
   */
  public async scrape(
    scrapeOpts: IBankScrapeStrategyOpts,
  ): Promise<Procedure<IRawScrape>> {
    scrapeOpts.logger.info(
      `  🔍 Scraping transactions from ${scrapeOpts.bankId}...`);
    const first = await this.executeAttempt(scrapeOpts);
    if (LiveScrapeStrategy.isInvalidOtpFailure(first)) {
      const retried = await this.retryAfterOtpReject(scrapeOpts);
      const retryEnvelope = LiveScrapeStrategy.wrap(scrapeOpts, retried, 2);
      return succeed(retryEnvelope);
    }
    const firstEnvelope = LiveScrapeStrategy.wrap(scrapeOpts, first, 1);
    return succeed(firstEnvelope);
  }

  /**
   * Executes a single scrape attempt with retry + timeout wrappers.
   * @param scrapeOpts - Per-scrape inputs.
   * @returns Provider scrape result from the attempt.
   */
  private executeAttempt(
    scrapeOpts: IBankScrapeStrategyOpts,
  ): Promise<IScraperScrapingResult> {
    const { scraper, credentials } = this.initScrape(scrapeOpts);
    const isTwoFactor = scrapeOpts.bankConfig.twoFactorAuth;
    const retryStrategy = isTwoFactor ? this.opts.noRetryStrategy : this.opts.retryStrategy;
    const label = `Scraping ${scrapeOpts.bankId}`;
    const timeoutMs = DEFAULT_RESILIENCE_CONFIG.scrapingTimeoutMs;
    const timeoutWrapper = this.opts.timeoutWrapper;
    /**
     * Wraps the provider scrape call with the timeout deadline.
     * @returns Provider scrape result, or rejects on timeout.
     */
    const wrapped = (): Promise<IScraperScrapingResult> => {
      const scrapePromise = scraper.scrape(credentials);
      return timeoutWrapper.wrap(scrapePromise, timeoutMs, label);
    };
    return retryStrategy.execute(wrapped, label);
  }

  /**
   * Builds the scraper, credentials, and OTP retriever for the bank.
   * @param scrapeOpts - Per-scrape inputs.
   * @returns Object exposing the configured scraper and credentials.
   */
  private initScrape(
    scrapeOpts: IBankScrapeStrategyOpts,
  ): { scraper: ReturnType<typeof createScraper>; credentials: ScraperCredentials } {
    const retriever = scrapeOpts.otpRetriever
      ?? LiveScrapeStrategy.buildOtpRetriever({
        bankId: scrapeOpts.bankId,
        bankConfig: scrapeOpts.bankConfig,
        notifier: this.opts.telegramNotifier,
        logger: scrapeOpts.logger,
      });
    const options = this.buildScraperOptions(scrapeOpts, retriever);
    const scraper = LiveScrapeStrategy.prepareScraper(scrapeOpts, options);
    const credentials = buildCredentials(scrapeOpts.bankConfig, retriever);
    return { scraper, credentials };
  }

  /**
   * Assembles ScraperOptions including start date and OTP retriever.
   * @param scrapeOpts - Per-scrape inputs.
   * @param otpRetriever - Optional async OTP code provider.
   * @returns ScraperOptions ready for createScraper().
   */
  private buildScraperOptions(
    scrapeOpts: IBankScrapeStrategyOpts,
    otpRetriever: (() => Promise<string>) | undefined,
  ): ScraperOptions {
    const navRetry = scrapeOpts.bankConfig.navigationRetryCount;
    const base: ScraperOptions = {
      companyId: scrapeOpts.companyType,
      startDate: scrapeOpts.startDate,
      args: buildChromeArgs(this.opts.config.proxy),
      defaultTimeout: scrapeOpts.bankConfig.timeout ?? 60_000,
    };
    if (navRetry) base.navigationRetryCount = navRetry;
    if (otpRetriever) {
      /**
       * Adapter from the provider's otpCodeRetriever signature to our retriever.
       * @returns Async OTP code resolved from the injected retriever.
       */
      base.otpCodeRetriever = (): Promise<string> => otpRetriever();
    }
    return base;
  }

  /**
   * Notifies the user the OTP was rejected, then re-runs the scrape.
   * @param scrapeOpts - Scrape inputs reused for the second attempt.
   * @returns Provider scrape result from the retry attempt.
   */
  private async retryAfterOtpReject(
    scrapeOpts: IBankScrapeStrategyOpts,
  ): Promise<IScraperScrapingResult> {
    scrapeOpts.logger.warn(
      `  ⚠️  OTP rejected — requesting a new code for ${scrapeOpts.bankId}`);
    const message = `⚠️ OTP for <b>${scrapeOpts.bankId}</b> was rejected. `
      + 'A new code will be requested — please check your SMS.';
    await this.opts.notificationService.sendMessage(message);
    return await this.executeAttempt(scrapeOpts);
  }

  /**
   * Detects an INVALID_OTP failure on a provider result.
   * @param result - Provider scrape result to inspect.
   * @returns True when the result is a failure of type INVALID_OTP.
   */
  private static isInvalidOtpFailure(result: IScraperScrapingResult): boolean {
    const didFail = !result.success;
    const isOtpError = String(result.errorType) === 'INVALID_OTP';
    return didFail && isOtpError;
  }

  /**
   * Builds a Telegram-based OTP retriever for 2FA banks when applicable.
   * @param params - Bank id, bank config, notifier, logger.
   * @returns Async OTP retriever, or undefined when 2FA is not needed.
   */
  private static buildOtpRetriever(
    params: IOtpRetrieverParams,
  ): (() => Promise<string>) | undefined {
    const noRetriever: (() => Promise<string>) | undefined = undefined;
    const hasTelegram = params.notifier !== null;
    const isRetrieverNeeded =
      LiveScrapeStrategy.needsOtpRetriever(params.bankConfig, hasTelegram);
    if (!params.notifier || !isRetrieverNeeded) return noRetriever;
    const twoFactor = new TwoFactorService(params.notifier, params.bankConfig.twoFactorTimeout);
    params.logger.info(`  🔐 2FA enabled for ${params.bankId} (via Telegram)`);
    return twoFactor.createOtpRetriever(params.bankId);
  }

  /**
   * Determines whether a Telegram OTP retriever is needed for this bank.
   * @param bankConfig - Bank configuration whose twoFactorAuth flag is read.
   * @param hasTelegram - True when a Telegram notifier is configured.
   * @returns True when 2FA + Telegram is configured and no long-term token is stored.
   */
  private static needsOtpRetriever(bankConfig: IBankConfig, hasTelegram: boolean): boolean {
    return Boolean(
      bankConfig.twoFactorAuth
      && !bankConfig.otpLongTermToken
      && hasTelegram,
    );
  }

  /**
   * Clears any stale browser session and creates the scraper.
   * @param scrapeOpts - Per-scrape inputs.
   * @param options - ScraperOptions assembled by buildScraperOptions.
   * @returns The newly created provider scraper instance.
   */
  private static prepareScraper(
    scrapeOpts: IBankScrapeStrategyOpts, options: ScraperOptions,
  ): ReturnType<typeof createScraper> {
    if (scrapeOpts.bankConfig.clearSession) {
      LiveScrapeStrategy.clearBankSession(scrapeOpts.bankId, scrapeOpts.logger);
    }
    scrapeOpts.logger.info(`  🔧 Creating scraper for ${scrapeOpts.bankId}...`);
    return createScraper(options);
  }

  /**
   * Deletes a bank's Chrome session directory to force a clean login.
   * @param bankId - Bank id whose Chrome data directory will be cleared.
   * @param logger - Logger used to report clear and warn on failures.
   */
  private static clearBankSession(bankId: string, logger: ILogger): void {
    const bankDir = getChromeDataDir(bankId);
    if (!existsSync(bankDir)) return;
    logger.info(`  🧹 Clearing browser session for ${bankId}`);
    try {
      rmSync(bankDir, { recursive: true, force: true });
    } catch (error) {
      const msg = errorMessage(error);
      logger.warn(`  ⚠️  Failed to clear session for ${bankId}: ${msg}`);
    }
  }

  /**
   * Builds an IRawScrape envelope around a provider result.
   * @param scrapeOpts - Per-scrape inputs.
   * @param raw - Raw provider scrape result.
   * @param attemptCount - 1 or 2 depending on whether OTP retry fired.
   * @returns Frozen IRawScrape envelope.
   */
  private static wrap(
    scrapeOpts: IBankScrapeStrategyOpts,
    raw: IScraperScrapingResult, attemptCount: number,
  ): IRawScrape {
    return {
      bankId: scrapeOpts.bankId, companyType: scrapeOpts.companyType,
      attemptCount, strategy: 'live', raw,
    };
  }
}
