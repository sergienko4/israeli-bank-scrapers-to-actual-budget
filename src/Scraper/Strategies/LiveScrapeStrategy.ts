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
  CompanyTypes,
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
import { DEFAULT_RESILIENCE_CONFIG, fail, succeed } from '../../Types/Index.js';
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

/**
 * Internal opts after the public scrape() has verified companyType is set.
 * Narrows companyType from optional to required so downstream helpers can
 * use it without re-asserting on every call.
 */
type IResolvedLiveOpts = Omit<IBankScrapeStrategyOpts, 'companyType'> & {
  readonly companyType: CompanyTypes;
};

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
    const resolved = LiveScrapeStrategy.resolveOpts(scrapeOpts);
    if (!resolved.success) return resolved;
    resolved.data.logger.info(
      `  🔍 Scraping transactions from ${resolved.data.bankId}...`);
    return await this.runWithOtpRetry(resolved.data);
  }

  /**
   * Validates companyType is present and narrows opts for downstream helpers.
   * @param scrapeOpts - Raw opts from the BankScraper coordinator.
   * @returns Procedure success with IResolvedLiveOpts, or unknown-bank failure.
   */
  private static resolveOpts(
    scrapeOpts: IBankScrapeStrategyOpts,
  ): Procedure<IResolvedLiveOpts> {
    if (!scrapeOpts.companyType) {
      return fail(
        `Unknown bank: ${scrapeOpts.bankId}`,
        { status: 'unknown-bank' },
      );
    }
    return succeed({ ...scrapeOpts, companyType: scrapeOpts.companyType });
  }

  /**
   * Runs the first attempt and dispatches the OTP-retry path when needed.
   * @param scrapeOpts - Narrowed opts produced by resolveOpts.
   * @returns Procedure success with the wrapped IRawScrape envelope.
   */
  private async runWithOtpRetry(
    scrapeOpts: IResolvedLiveOpts,
  ): Promise<Procedure<IRawScrape>> {
    const first = await this.executeAttempt(scrapeOpts);
    if (LiveScrapeStrategy.isInvalidOtpFailure(first)) {
      return await this.handleOtpReject(scrapeOpts);
    }
    return LiveScrapeStrategy.wrapSucceed(scrapeOpts, first, 1);
  }

  /**
   * Runs the OTP-rejected retry path and wraps the retried provider result.
   * @param scrapeOpts - Per-scrape inputs reused for the retry attempt.
   * @returns Procedure success with attemptCount=2 envelope.
   */
  private async handleOtpReject(
    scrapeOpts: IResolvedLiveOpts,
  ): Promise<Procedure<IRawScrape>> {
    const retried = await this.retryAfterOtpReject(scrapeOpts);
    return LiveScrapeStrategy.wrapSucceed(scrapeOpts, retried, 2);
  }

  /**
   * Wraps a provider result in an IRawScrape envelope and returns succeed().
   * @param scrapeOpts - Per-scrape inputs.
   * @param raw - Provider scrape result.
   * @param attemptCount - 1 or 2 depending on retry path.
   * @returns Procedure success carrying the wrapped envelope.
   */
  private static wrapSucceed(
    scrapeOpts: IResolvedLiveOpts,
    raw: IScraperScrapingResult, attemptCount: number,
  ): Procedure<IRawScrape> {
    const envelope = LiveScrapeStrategy.wrap(scrapeOpts, raw, attemptCount);
    return succeed(envelope);
  }

  /**
   * Executes a single scrape attempt with retry + timeout wrappers.
   * @param scrapeOpts - Per-scrape inputs.
   * @returns Provider scrape result from the attempt.
   */
  private executeAttempt(
    scrapeOpts: IResolvedLiveOpts,
  ): Promise<IScraperScrapingResult> {
    const { scraper, credentials } = this.initScrape(scrapeOpts);
    const retryStrategy = this.pickRetryStrategy(scrapeOpts.bankConfig);
    const label = `Scraping ${scrapeOpts.bankId}`;
    const wrapped = this.buildTimeoutWrappedScrape(scraper, credentials, label);
    return retryStrategy.execute(wrapped, label);
  }

  /**
   * Picks the retry strategy based on whether the bank uses 2FA.
   * @param bankConfig - Bank config whose twoFactorAuth is inspected.
   * @returns noRetryStrategy for 2FA banks, retryStrategy otherwise.
   */
  private pickRetryStrategy(bankConfig: IBankConfig): IRetryStrategy {
    const isTwoFactor = bankConfig.twoFactorAuth;
    return isTwoFactor ? this.opts.noRetryStrategy : this.opts.retryStrategy;
  }

  /**
   * Builds a timeout-wrapped invocation of scraper.scrape(credentials).
   * @param scraper - Created scraper instance.
   * @param credentials - Credentials bundle passed to scraper.scrape.
   * @param label - Diagnostic label for the timeout wrapper.
   * @returns Zero-arg function returning the scrape result subject to timeout.
   */
  private buildTimeoutWrappedScrape(
    scraper: ReturnType<typeof createScraper>,
    credentials: ScraperCredentials, label: string,
  ): () => Promise<IScraperScrapingResult> {
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
    return wrapped;
  }

  /**
   * Builds the scraper, credentials, and OTP retriever for the bank.
   * @param scrapeOpts - Per-scrape inputs.
   * @returns Object exposing the configured scraper and credentials.
   */
  private initScrape(
    scrapeOpts: IResolvedLiveOpts,
  ): { scraper: ReturnType<typeof createScraper>; credentials: ScraperCredentials } {
    const retriever = this.resolveOtpRetriever(scrapeOpts);
    const options = this.buildScraperOptions(scrapeOpts, retriever);
    const scraper = LiveScrapeStrategy.prepareScraper(scrapeOpts, options);
    const credentials = buildCredentials(scrapeOpts.bankConfig, retriever);
    return { scraper, credentials };
  }

  /**
   * Resolves the OTP retriever: caller-provided override, or registry-built.
   * @param scrapeOpts - Per-scrape inputs (bankId, bankConfig, logger).
   * @returns OTP retriever, or undefined when 2FA is not needed.
   */
  private resolveOtpRetriever(
    scrapeOpts: IResolvedLiveOpts,
  ): (() => Promise<string>) | undefined {
    return scrapeOpts.otpRetriever
      ?? LiveScrapeStrategy.buildOtpRetriever({
        bankId: scrapeOpts.bankId,
        bankConfig: scrapeOpts.bankConfig,
        notifier: this.opts.telegramNotifier,
        logger: scrapeOpts.logger,
      });
  }

  /**
   * Assembles ScraperOptions including start date and OTP retriever.
   * @param scrapeOpts - Per-scrape inputs.
   * @param otpRetriever - Optional async OTP code provider.
   * @returns ScraperOptions ready for createScraper().
   */
  private buildScraperOptions(
    scrapeOpts: IResolvedLiveOpts,
    otpRetriever: (() => Promise<string>) | undefined,
  ): ScraperOptions {
    const base = this.buildBaseScraperOptions(scrapeOpts);
    LiveScrapeStrategy.attachOtpRetriever(base, otpRetriever);
    return base;
  }

  /**
   * Builds the base ScraperOptions (companyId, startDate, args, timeouts).
   * @param scrapeOpts - Per-scrape inputs supplying companyType + bankConfig.
   * @returns ScraperOptions with navigationRetryCount applied when set.
   */
  private buildBaseScraperOptions(scrapeOpts: IResolvedLiveOpts): ScraperOptions {
    const base: ScraperOptions = {
      companyId: scrapeOpts.companyType,
      startDate: scrapeOpts.startDate,
      args: buildChromeArgs(this.opts.config.proxy),
      defaultTimeout: scrapeOpts.bankConfig.timeout ?? 60_000,
    };
    const navRetry = scrapeOpts.bankConfig.navigationRetryCount;
    if (navRetry) base.navigationRetryCount = navRetry;
    return base;
  }

  /**
   * Attaches an OTP retriever adapter to the ScraperOptions when configured.
   * @param target - ScraperOptions object that will be mutated in place.
   * @param otpRetriever - Optional async OTP code provider.
   */
  private static attachOtpRetriever(
    target: ScraperOptions,
    otpRetriever: (() => Promise<string>) | undefined,
  ): void {
    if (!otpRetriever) return;
    /**
     * Adapter from the provider's otpCodeRetriever signature to our retriever.
     * @returns Async OTP code resolved from the injected retriever.
     */
    target.otpCodeRetriever = (): Promise<string> => otpRetriever();
  }

  /**
   * Notifies the user the OTP was rejected, then re-runs the scrape.
   * @param scrapeOpts - Scrape inputs reused for the second attempt.
   * @returns Provider scrape result from the retry attempt.
   */
  private async retryAfterOtpReject(
    scrapeOpts: IResolvedLiveOpts,
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
    scrapeOpts: IResolvedLiveOpts, options: ScraperOptions,
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
    } catch (error: unknown) {
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
    scrapeOpts: IResolvedLiveOpts,
    raw: IScraperScrapingResult, attemptCount: number,
  ): IRawScrape {
    return {
      bankId: scrapeOpts.bankId, companyType: scrapeOpts.companyType,
      attemptCount, strategy: 'live', raw,
    };
  }
}
