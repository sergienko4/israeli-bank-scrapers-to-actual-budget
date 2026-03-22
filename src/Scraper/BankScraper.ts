/**
 * Bank scraping orchestration extracted from Index.ts to keep it under 300 lines.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';

import type {
IScraperScrapingResult,
ScraperCredentials,   ScraperOptions} from '@sergienko4/israeli-bank-scrapers';
import { CompanyTypes,createScraper } from '@sergienko4/israeli-bank-scrapers';

import { getScraperErrorAdvice } from '../Errors/ScraperErrorMessages.js';
import { getLogger } from '../Logger/Index.js';
import type { IRetryStrategy } from '../Resilience/RetryStrategy.js';
import type { ITimeoutWrapper } from '../Resilience/TimeoutWrapper.js';
import type TelegramNotifier from '../Services/Notifications/TelegramNotifier.js';
import type NotificationService from '../Services/NotificationService.js';
import TwoFactorService from '../Services/TwoFactorService.js';
import type { IBankConfig,IImporterConfig, IProcedureSuccess, Procedure } from '../Types/Index.js';
import { DEFAULT_RESILIENCE_CONFIG, fail, succeed } from '../Types/Index.js';
import { errorMessage, filterByDateCutoff,formatDate } from '../Utils/Index.js';
import buildCredentials from './CredentialsBuilder.js';
import { buildChromeArgs, getChromeDataDir } from './ScraperOptionsBuilder.js';

/** Company type map used to look up the scraper ID for each bank name. */
type CompanyType = typeof CompanyTypes[keyof typeof CompanyTypes];
const COMPANY_TYPE_MAP: Partial<Record<string, CompanyType>> = {
  'hapoalim': CompanyTypes.Hapoalim, 'leumi': CompanyTypes.Leumi,
  'discount': CompanyTypes.Discount, 'mizrahi': CompanyTypes.Mizrahi,
  'mercantile': CompanyTypes.Mercantile, 'otsarHahayal': CompanyTypes.OtsarHahayal,
  'otsarhahayal': CompanyTypes.OtsarHahayal, 'beinleumi': CompanyTypes.Beinleumi,
  'massad': CompanyTypes.Massad, 'yahav': CompanyTypes.Yahav,
  'visaCal': CompanyTypes.VisaCal, 'visacal': CompanyTypes.VisaCal,
  'max': CompanyTypes.Max, 'isracard': CompanyTypes.Isracard,
  'amex': CompanyTypes.Amex, 'beyahadBishvilha': CompanyTypes.BeyahadBishvilha,
  'beyahadbishvilha': CompanyTypes.BeyahadBishvilha, 'behatsdaa': CompanyTypes.Behatsdaa,
  'pagi': CompanyTypes.Pagi, 'oneZero': CompanyTypes.OneZero, 'onezero': CompanyTypes.OneZero,
};


const NO_RECORDS_PATTERNS = [
  'no transactions found', 'no results found', 'לא מצאנו תנועות',
];

/**
 * Computes the transaction start date based on daysBack or startDate config.
 * @param bankConfig - The IBankConfig whose date settings to use.
 * @returns The computed start Date for scraping.
 */
export function computeStartDate(bankConfig: IBankConfig): Date {
  if (bankConfig.daysBack) {
    const date = new Date();
    date.setDate(date.getDate() - (bankConfig.daysBack - 1));
    return date;
  }
  return bankConfig.startDate ? new Date(bankConfig.startDate) : new Date();
}

/**
 * Filters transactions to only those on or after the bank's configured start date.
 * @param txns - Array of transactions to filter.
 * @param bankConfig - Bank config providing the cutoff date.
 * @returns Filtered array, or original if no date filter is configured.
 */
export function filterTransactionsByDate<T extends { date: Date | string }>(
  txns: T[], bankConfig: IBankConfig
): T[] {
  if (!bankConfig.daysBack && !bankConfig.startDate) return txns;
  const startDate = computeStartDate(bankConfig);
  const formattedDate = formatDate(startDate);
  return filterByDateCutoff(txns, formattedDate);
}

/**
 * Checks whether a scraper failure indicates "no transactions found" vs. a real error.
 * @param result - The IScraperScrapingResult to inspect.
 * @returns True when the error message matches a known empty-result pattern.
 */
export function isEmptyResultError(result: IScraperScrapingResult): boolean {
  const msg = (result.errorMessage ?? '').toLowerCase();
  /**
   * Checks if the message contains the given pattern (case-insensitive).
   * @param p - Pattern string to match against.
   * @returns True if the lowered message contains the lowered pattern.
   */
  const matchesPattern = (p: string): boolean => {
    const lowered = p.toLowerCase();
    return msg.includes(lowered);
  };
  return NO_RECORDS_PATTERNS.some(matchesPattern);
}

/**
 * Logs a scraper failure with a user-friendly hint based on the error type.
 * @param bankName - The name of the bank that failed.
 * @param result - The failed IScraperScrapingResult containing error details.
 * @returns A successful Procedure indicating the failure was logged.
 */
export function logScrapeFailure(
  bankName: string, result: IScraperScrapingResult
): IProcedureSuccess<{ status: string }> {
  const baseMsg = result.errorMessage ?? 'Unknown error';
  const advice = getScraperErrorAdvice(result.errorType ?? '');
  const hint = advice ? `. ${advice}` : '';
  getLogger().error(`  ❌ Failed to scrape ${bankName}: ${baseMsg}${hint}`);
  return succeed({ status: 'logged' });
}

/** Options injected into BankScraper for all scraping operations. */
export interface IBankScraperOpts {
  /** Full importer configuration (needed for proxy settings). */
  config: IImporterConfig;
  /** Retry strategy used for normal bank scrapes. */
  retryStrategy: IRetryStrategy;
  /** Retry strategy used for OTP banks (no retry — code is consumed on first use). */
  noRetryStrategy: IRetryStrategy;
  /** Timeout wrapper applied to each scrape attempt. */
  timeoutWrapper: ITimeoutWrapper;
  /** Telegram notifier for OTP prompts; null when Telegram is not configured. */
  telegramNotifier: TelegramNotifier | null;
  /** Notification service for retry messages. */
  notificationService: NotificationService;
}

/** Orchestrates bank scraping: session management, OTP, mock data, and retry logic. */
export class BankScraper {
  /**
   * Creates a BankScraper with the given scraping dependencies.
   * @param opts - All services and strategies needed for scraping.
   */
  constructor(private readonly opts: IBankScraperOpts) {}

  /**
   * Scrapes a bank: uses mock data in E2E mode, retries once on INVALID_OTP.
   * @param bankName - The bank key to scrape.
   * @param bankConfig - The bank's full configuration.
   * @returns The final IScraperScrapingResult after resilience handling.
   */
  public async scrapeBankWithResilience(
    bankName: string, bankConfig: IBankConfig
  ): Promise<IScraperScrapingResult> {
    const mockResult = BankScraper.loadMockScraperResult(bankName);
    if (mockResult.success) return mockResult.data;
    getLogger().info(`  🔍 Scraping transactions from ${bankName}...`);
    const result = await this.executeScrapeAttempt(bankName, bankConfig);
    if (!result.success && String(result.errorType) === 'INVALID_OTP') {
      return this.retryOtpScrape(bankName, bankConfig);
    }
    return result;
  }

  /**
   * Performs a single scrape attempt, applying the appropriate retry strategy.
   * @param bankName - The bank to scrape.
   * @param bankConfig - The bank's configuration.
   * @returns The IScraperScrapingResult from the attempt.
   */
  private async executeScrapeAttempt(
    bankName: string, bankConfig: IBankConfig
  ): Promise<IScraperScrapingResult> {
    const { scraper, credentials } = this.initBankScrape(bankName, bankConfig);
    const strategy = bankConfig.twoFactorAuth
      ? this.opts.noRetryStrategy : this.opts.retryStrategy;
    const label = `Scraping ${bankName}`;
    const timeoutMs = DEFAULT_RESILIENCE_CONFIG.scrapingTimeoutMs;
    /**
     * Scrapes and wraps the result with a timeout.
     * @returns Promise resolving to the scraper result.
     */
    const scrapeWithTimeout = (): Promise<IScraperScrapingResult> => {
      const scrapePromise = scraper.scrape(credentials);
      return this.opts.timeoutWrapper.wrap(scrapePromise, timeoutMs, label);
    };
    return strategy.execute(scrapeWithTimeout, label);
  }

  /**
   * Notifies the user that an OTP was rejected and retries the scrape.
   * @param bankName - The bank whose OTP was rejected.
   * @param bankConfig - The bank's configuration for the retry.
   * @returns The IScraperScrapingResult from the retry attempt.
   */
  private async retryOtpScrape(
    bankName: string, bankConfig: IBankConfig
  ): Promise<IScraperScrapingResult> {
    getLogger().warn(`  ⚠️  OTP rejected — requesting a new code for ${bankName}`);
    await this.opts.notificationService.sendMessage(
      `⚠️ OTP for <b>${bankName}</b> was rejected. ` +
      'A new code will be requested — please check your SMS.'
    );
    return this.executeScrapeAttempt(bankName, bankConfig);
  }

  /**
   * Looks up the company type, builds OTP retriever, creates scraper + credentials.
   * @param bankName - The bank key used to look up CompanyTypes.
   * @param bankConfig - The bank's full configuration.
   * @returns Object with the initialized scraper and credentials.
   */
  private initBankScrape(
    bankName: string, bankConfig: IBankConfig
  ): { scraper: ReturnType<typeof createScraper>; credentials: ScraperCredentials } {
    const companyType = COMPANY_TYPE_MAP[bankName.toLowerCase()];
    if (!companyType) throw new TypeError(`Unknown bank: ${bankName}`);
    const otpRetriever = this.buildOtpRetriever(bankName, bankConfig);
    const options = this.buildScraperOptions(companyType, bankConfig, otpRetriever);
    return {
      scraper: BankScraper.prepareScraper(bankConfig, bankName, options),
      credentials: buildCredentials(bankConfig, otpRetriever),
    };
  }

  /**
   * Optionally clears the bank session, logs the date range, and creates a scraper.
   * @param bankConfig - Bank configuration for session and logging.
   * @param bankName - The bank name used for logging.
   * @param options - ScraperOptions to pass to createScraper.
   * @returns The newly created scraper instance.
   */
  private static prepareScraper(
    bankConfig: IBankConfig, bankName: string, options: ScraperOptions
  ): ReturnType<typeof createScraper> {
    if (bankConfig.clearSession) BankScraper.clearBankSession(bankName);
    getLogger().info(`  🔧 Creating scraper for ${bankName}...`);
    BankScraper.logDateRange(bankConfig);
    return createScraper(options);
  }

  /**
   * Builds ScraperOptions including start date, Chrome args, and optional OTP retriever.
   * @param companyType - The CompanyTypes enum value for the target bank.
   * @param bankConfig - The bank's configuration.
   * @param otpRetriever - Optional async OTP code provider.
   * @returns Configured ScraperOptions ready for createScraper().
   */
  private buildScraperOptions(
    companyType: typeof CompanyTypes[keyof typeof CompanyTypes],
    bankConfig: IBankConfig,
    otpRetriever?: () => Promise<string>
  ): ScraperOptions {
    return {
      companyId: companyType,
      startDate: computeStartDate(bankConfig),
      args: buildChromeArgs(this.opts.config.proxy),
      defaultTimeout: bankConfig.timeout ?? 60_000,
      ...(bankConfig.navigationRetryCount
        ? { navigationRetryCount: bankConfig.navigationRetryCount } : {}),
      ...(otpRetriever
        ? {
          /**
           * Delegates to the injected otpRetriever, ignoring the phone hint.
           * @param _phoneHint - Phone hint from the scraper (not used).
           * @returns Promise resolving to the OTP code string.
           */
          otpCodeRetriever: (_phoneHint: string) => otpRetriever()
        } : {}),
    };
  }

  /**
   * Determines whether a Telegram-based OTP retriever is needed for this bank.
   * @param bankConfig - The IBankConfig whose twoFactorAuth flag is read.
   * @returns True when 2FA is enabled and Telegram is configured.
   */
  private needsOtpRetriever(bankConfig: IBankConfig): boolean {
    return Boolean(
      bankConfig.twoFactorAuth
      && !bankConfig.otpLongTermToken
      && this.opts.telegramNotifier
    );
  }

  /**
   * Creates a Telegram-based OTP retriever for 2FA banks when configured.
   * @param bankName - The bank name used in the Telegram prompt.
   * @param bankConfig - The IBankConfig whose twoFactorAuth flag is read.
   * @returns An async OTP retriever function, or undefined if 2FA is not needed.
   */
  private buildOtpRetriever(
    bankName: string, bankConfig: IBankConfig
  ): (() => Promise<string>) | undefined {
    const notifier = this.opts.telegramNotifier;
    if (!this.needsOtpRetriever(bankConfig) || !notifier) {
      const noRetriever = void 0;
      return noRetriever;
    }
    const twoFactor = new TwoFactorService(notifier, bankConfig.twoFactorTimeout);
    getLogger().info(`  🔐 2FA enabled for ${bankName} (via Telegram)`);
    return twoFactor.createOtpRetriever(bankName);
  }

  /**
   * Deletes the Chrome browser session data for a bank to force a clean login.
   * @param bankName - The bank whose Chrome data directory should be cleared.
   */
  private static clearBankSession(bankName: string): void {
    const bankDir = getChromeDataDir(bankName);
    if (!existsSync(bankDir)) return;
    getLogger().info(`  🧹 Clearing browser session for ${bankName}`);
    try { rmSync(bankDir, { recursive: true, force: true }); }
    catch (error: unknown) {
      const msg = errorMessage(error);
      getLogger().warn(`  ⚠️  Failed to clear session for ${bankName}: ${msg}`);
    }
  }

  /**
   * Logs the effective date range being used for scraping.
   * @param bankConfig - The IBankConfig whose date settings to display.
   */
  private static logDateRange(bankConfig: IBankConfig): void {
    if (bankConfig.daysBack) {
      const startDate = computeStartDate(bankConfig);
      getLogger().info(
        `  📅 Date range: last ${String(bankConfig.daysBack)} days ` +
        `(from ${formatDate(startDate)})`
      );
    } else if (bankConfig.startDate) {
      getLogger().info(`  📅 Date range: from ${bankConfig.startDate} to today`);
    } else {
      getLogger().info('  📅 Date range: using bank default (usually ~1 year)');
    }
  }

  /**
   * Loads a mock scraper result when E2E mock env vars are set.
   * @param bankName - The bank whose mock data file to load.
   * @returns Procedure with the parsed result on success, or failure if mock mode is inactive.
   */
  private static loadMockScraperResult(
    bankName: string
  ): Procedure<IScraperScrapingResult> {
    const mockDir = process.env.E2E_MOCK_SCRAPER_DIR;
    let mockDirFile = '';
    if (mockDir) {
      const bankSpecificFile = `${mockDir}/${bankName}.json`;
      mockDirFile = existsSync(bankSpecificFile)
        ? bankSpecificFile : `${mockDir}/default.json`;
    }
    const file = mockDirFile || process.env.E2E_MOCK_SCRAPER_FILE || '';
    if (!file) return fail('Mock mode is not active');
    getLogger().info(`  🧪 Using mock scraper data from ${file}`);
    const parsed = BankScraper.parseMockFile(file);
    return succeed(parsed);
  }

  /**
   * Reads and parses a mock scraper JSON file for E2E testing.
   * @param filePath - Absolute path to the mock JSON file.
   * @returns Parsed IScraperScrapingResult.
   */
  private static parseMockFile(filePath: string): IScraperScrapingResult {
    const raw = readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const data = parsed as { success?: boolean; accounts?: unknown[] };
    if (typeof data.success !== 'boolean' || !Array.isArray(data.accounts)) {
      throw new TypeError('Invalid mock scraper file: missing success or accounts');
    }
    return data as IScraperScrapingResult;
  }
}
