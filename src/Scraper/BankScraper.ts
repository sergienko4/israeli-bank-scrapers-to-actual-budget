/**
 * Bank scraping orchestration extracted from Index.ts to keep it under 300 lines.
 */
import { readFileSync, existsSync, rmSync } from 'node:fs';
import type {
  ScraperOptions, ScraperCredentials, IScraperScrapingResult
} from '@sergienko4/israeli-bank-scrapers';
import { createScraper, CompanyTypes } from '@sergienko4/israeli-bank-scrapers';
import type { IRetryStrategy } from '../Resilience/RetryStrategy.js';
import type { ITimeoutWrapper } from '../Resilience/TimeoutWrapper.js';
import type { NotificationService } from '../Services/NotificationService.js';
import type { TelegramNotifier } from '../Services/Notifications/TelegramNotifier.js';
import { TwoFactorService } from '../Services/TwoFactorService.js';
import { buildChromeArgs, getChromeDataDir } from './ScraperOptionsBuilder.js';
import { buildCredentials } from './CredentialsBuilder.js';
import type { ImporterConfig, BankConfig } from '../Types/Index.js';
import { DEFAULT_RESILIENCE_CONFIG } from '../Types/Index.js';
import { formatDate, filterByDateCutoff } from '../Utils/Index.js';
import { getLogger } from '../Logger/Index.js';

/** Company type map used to look up the scraper ID for each bank name. */
const companyTypeMap: Record<string, typeof CompanyTypes[keyof typeof CompanyTypes]> = {
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

const scrapeErrorHints: Record<string, string> = {
  WAF_BLOCKED: '. WAF blocked the request — wait 1-2 hours before retrying',
  CHANGE_PASSWORD: '. The bank requires a password change — log in via browser first',
  ACCOUNT_BLOCKED: '. Your account is blocked — contact your bank',
  INVALID_OTP: '. OTP rejected — the code may have expired. Enter it quickly next time',
};

const NO_RECORDS_PATTERNS = [
  'no transactions found', 'no results found', 'לא מצאנו תנועות',
];

/**
 * Computes the transaction start date based on daysBack or startDate config.
 * @param bankConfig - The BankConfig whose date settings to use.
 * @returns The computed start Date for scraping.
 */
export function computeStartDate(bankConfig: BankConfig): Date {
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
  txns: T[], bankConfig: BankConfig
): T[] {
  if (!bankConfig.daysBack && !bankConfig.startDate) return txns;
  return filterByDateCutoff(txns, formatDate(computeStartDate(bankConfig)));
}

/**
 * Checks whether a scraper failure indicates "no transactions found" vs. a real error.
 * @param result - The IScraperScrapingResult to inspect.
 * @returns True when the error message matches a known empty-result pattern.
 */
export function isEmptyResultError(result: IScraperScrapingResult): boolean {
  const msg = (result.errorMessage ?? '').toLowerCase();
  return NO_RECORDS_PATTERNS.some(p => msg.includes(p.toLowerCase()));
}

/**
 * Logs a scraper failure with a user-friendly hint based on the error type.
 * @param bankName - The name of the bank that failed.
 * @param result - The failed IScraperScrapingResult containing error details.
 */
export function logScrapeFailure(bankName: string, result: IScraperScrapingResult): void {
  const hint = scrapeErrorHints[result.errorType ?? ''] ?? '';
  getLogger().error(
    `  ❌ Failed to scrape ${bankName}: ${result.errorMessage || 'Unknown error'}${hint}`
  );
}

/** Options injected into BankScraper for all scraping operations. */
export interface BankScraperOpts {
  /** Full importer configuration (needed for proxy settings). */
  config: ImporterConfig;
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
  constructor(private readonly opts: BankScraperOpts) {}

  /**
   * Scrapes a bank: uses mock data in E2E mode, retries once on INVALID_OTP.
   * @param bankName - The bank key to scrape.
   * @param bankConfig - The bank's full configuration.
   * @returns The final IScraperScrapingResult after resilience handling.
   */
  async scrapeBankWithResilience(
    bankName: string, bankConfig: BankConfig
  ): Promise<IScraperScrapingResult> {
    const mockResult = this.loadMockScraperResult(bankName);
    if (mockResult) return mockResult;
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
    bankName: string, bankConfig: BankConfig
  ): Promise<IScraperScrapingResult> {
    const { scraper, credentials } = this.initBankScrape(bankName, bankConfig);
    const strategy = bankConfig.twoFactorAuth ? this.opts.noRetryStrategy : this.opts.retryStrategy;
    return strategy.execute(
      () => this.opts.timeoutWrapper.wrap(
        scraper.scrape(credentials),
        DEFAULT_RESILIENCE_CONFIG.scrapingTimeoutMs,
        `Scraping ${bankName}`
      ),
      `Scraping ${bankName}`
    );
  }

  /**
   * Notifies the user that an OTP was rejected and retries the scrape.
   * @param bankName - The bank whose OTP was rejected.
   * @param bankConfig - The bank's configuration for the retry.
   * @returns The IScraperScrapingResult from the retry attempt.
   */
  private async retryOtpScrape(
    bankName: string, bankConfig: BankConfig
  ): Promise<IScraperScrapingResult> {
    getLogger().warn(`  ⚠️  OTP rejected — requesting a new code for ${bankName}`);
    await this.opts.notificationService.sendMessage(
      `⚠️ OTP for <b>${bankName}</b> was rejected. ` +
      `A new code will be requested — please check your SMS.`
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
    bankName: string, bankConfig: BankConfig
  ): { scraper: ReturnType<typeof createScraper>; credentials: ScraperCredentials } {
    const companyType = companyTypeMap[bankName.toLowerCase()];
    if (!companyType) throw new Error(`Unknown bank: ${bankName}`);
    const otpRetriever = this.buildOtpRetriever(bankName, bankConfig);
    const options = this.buildScraperOptions(companyType, bankConfig, otpRetriever);
    return {
      scraper: this.prepareScraper(bankConfig, bankName, options),
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
  private prepareScraper(
    bankConfig: BankConfig, bankName: string, options: ScraperOptions
  ): ReturnType<typeof createScraper> {
    if (bankConfig.clearSession) this.clearBankSession(bankName);
    getLogger().info(`  🔧 Creating scraper for ${bankName}...`);
    this.logDateRange(bankConfig);
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
    bankConfig: BankConfig,
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
   * Creates a Telegram-based OTP retriever for 2FA banks when configured.
   * @param bankName - The bank name used in the Telegram prompt.
   * @param bankConfig - The BankConfig whose twoFactorAuth flag is read.
   * @returns An async OTP retriever function, or undefined if 2FA is not needed.
   */
  private buildOtpRetriever(
    bankName: string, bankConfig: BankConfig
  ): (() => Promise<string>) | undefined {
    if (!bankConfig.twoFactorAuth || bankConfig.otpLongTermToken || !this.opts.telegramNotifier) {
      return undefined;
    }
    const twoFactor = new TwoFactorService(this.opts.telegramNotifier, bankConfig.twoFactorTimeout);
    getLogger().info(`  🔐 2FA enabled for ${bankName} (via Telegram)`);
    return twoFactor.createOtpRetriever(bankName);
  }

  /**
   * Deletes the Chrome browser session data for a bank to force a clean login.
   * @param bankName - The bank whose Chrome data directory should be cleared.
   */
  private clearBankSession(bankName: string): void {
    const bankDir = getChromeDataDir(bankName);
    if (!existsSync(bankDir)) return;
    getLogger().info(`  🧹 Clearing browser session for ${bankName}`);
    try { rmSync(bankDir, { recursive: true, force: true }); }
    catch { getLogger().warn(`  ⚠️  Failed to clear session for ${bankName}`); }
  }

  /**
   * Logs the effective date range being used for scraping.
   * @param bankConfig - The BankConfig whose date settings to display.
   */
  private logDateRange(bankConfig: BankConfig): void {
    if (bankConfig.daysBack) {
      const startDate = computeStartDate(bankConfig);
      getLogger().info(
        `  📅 Date range: last ${bankConfig.daysBack} days ` +
        `(from ${formatDate(startDate)})`
      );
    } else if (bankConfig.startDate) {
      getLogger().info(`  📅 Date range: from ${bankConfig.startDate} to today`);
    } else {
      getLogger().info(`  📅 Date range: using bank default (usually ~1 year)`);
    }
  }

  /**
   * Loads a mock scraper result when E2E mock env vars are set.
   * @param bankName - The bank whose mock data file to load.
   * @returns Parsed IScraperScrapingResult or null if mock mode is inactive.
   */
  private loadMockScraperResult(bankName: string): IScraperScrapingResult | null {
    const mockDir = process.env.E2E_MOCK_SCRAPER_DIR;
    const file = mockDir
      ? (existsSync(`${mockDir}/${bankName}.json`)
        ? `${mockDir}/${bankName}.json` : `${mockDir}/default.json`)
      : (process.env.E2E_MOCK_SCRAPER_FILE ?? null);
    if (!file) return null;
    getLogger().info(`  🧪 Using mock scraper data from ${file}`);
    return this.parseMockFile(file);
  }

  /**
   * Reads and parses a mock scraper JSON file for E2E testing.
   * @param filePath - Absolute path to the mock JSON file.
   * @returns Parsed IScraperScrapingResult.
   */
  private parseMockFile(filePath: string): IScraperScrapingResult {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    const data = parsed as { success?: boolean; accounts?: unknown[] };
    if (typeof data.success !== 'boolean' || !Array.isArray(data.accounts)) {
      throw new Error(`Invalid mock scraper file: missing success or accounts`);
    }
    return data as IScraperScrapingResult;
  }
}
