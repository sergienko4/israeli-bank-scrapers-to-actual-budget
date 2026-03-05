/**
 * Israeli Bank Importer for Actual Budget
 * Main entry point with integrated resilience features
 *
 * This file is the top-level orchestration module that coordinates all
 * services — a legitimate exception to the max-lines-per-file rule.
 */
/* eslint-disable max-lines */

import api from '@actual-app/api';
import type { ScraperOptions,
  ScraperCredentials, ScraperScrapingResult
} from '@sergienko4/israeli-bank-scrapers';
import {
  createScraper, CompanyTypes
} from '@sergienko4/israeli-bank-scrapers';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { ConfigLoader } from './Config/ConfigLoader.js';
import { ErrorFormatter } from './Errors/ErrorFormatter.js';
import { ExponentialBackoffRetry } from './Resilience/RetryStrategy.js';
import { TimeoutWrapper } from './Resilience/TimeoutWrapper.js';
import { GracefulShutdownHandler } from './Resilience/GracefulShutdown.js';
import { MetricsService } from './Services/MetricsService.js';
import type { ImportResult, ImportTransactionsOpts
} from './Services/TransactionService.js';
import {
  TransactionService
} from './Services/TransactionService.js';
import { ReconciliationService } from './Services/ReconciliationService.js';
import { NotificationService } from './Services/NotificationService.js';
import { AuditLogService } from './Services/AuditLogService.js';
import { TwoFactorService } from './Services/TwoFactorService.js';
import { TelegramNotifier } from './Services/Notifications/TelegramNotifier.js';
import type {
  ImporterConfig, BankConfig, BankTarget,
  BankTransaction, CategorizationMode
} from './Types/Index.js';
import { DEFAULT_RESILIENCE_CONFIG
} from './Types/Index.js';
import { buildChromeArgs, getChromeDataDir } from './Scraper/ScraperOptionsBuilder.js';
import { buildCredentials } from './Scraper/CredentialsBuilder.js';
import { errorMessage, filterByDateCutoff, formatDate } from './Utils/Index.js';
import { createLogger, getLogger, deriveLogFormat } from './Logger/Index.js';
import type { ICategoryResolver } from './Services/ICategoryResolver.js';
import { HistoryCategoryResolver } from './Services/HistoryCategoryResolver.js';
import { TranslateCategoryResolver } from './Services/TranslateCategoryResolver.js';
import { SpendingWatchService } from './Services/SpendingWatchService.js';
import { DryRunCollector } from './Services/DryRunCollector.js';

// --validate mode: validate config and exit before full initialization
if (process.argv.includes('--validate')) {
  const { runValidateMode } = await import('./Config/ConfigValidator.js');
  process.exit(await runValidateMode());
}

// Load configuration and initialize logger
const configLoader = new ConfigLoader();
const config: ImporterConfig = configLoader.load();
const tg = config.notifications?.telegram;
const derivedFormat = deriveLogFormat(tg?.messageFormat, tg?.listenForCommands);
createLogger({
  ...config.logConfig,
  format: config.logConfig?.format ?? derivedFormat,
  logDir: config.logConfig?.logDir ?? './logs',
});
const logger = getLogger();

// Initialize resilience components
const shutdownHandler = new GracefulShutdownHandler();
const retryStrategy = new ExponentialBackoffRetry({
  maxAttempts: DEFAULT_RESILIENCE_CONFIG.maxRetryAttempts,
  initialBackoffMs: DEFAULT_RESILIENCE_CONFIG.initialBackoffMs,
  /**
   * Returns whether the shutdown handler is active.
   * @returns True once a shutdown signal has been received.
   */
  shouldShutdown: () => shutdownHandler.isShuttingDown(),
  /**
   * Returns false for WAF block errors so they are not retried.
   * @param error - The error from the failed attempt.
   * @returns True to retry, false for WAF blocks.
   */
  shouldRetry: (error) => error.name !== 'WafBlockError',
});
// OTP banks must not retry — the OTP code is consumed on first use
const noRetryStrategy = new ExponentialBackoffRetry({
  maxAttempts: 1,
  initialBackoffMs: 0,
  /**
   * Returns whether the shutdown handler is active.
   * @returns True once a shutdown signal has been received.
   */
  shouldShutdown: () => shutdownHandler.isShuttingDown(),
});
const timeoutWrapper = new TimeoutWrapper();
const errorFormatter = new ErrorFormatter();

// ─── Category resolver (OCP dispatch) ───

const resolverFactories: Record<
  CategorizationMode, (cfg: ImporterConfig) => ICategoryResolver | undefined
> = {
  /**
   * Returns undefined — no categorization applied.
   * @returns Always undefined.
   */
  none: () => undefined,
  /**
   * Returns a HistoryCategoryResolver backed by the Actual API.
   * @returns A new HistoryCategoryResolver.
   */
  history: () => new HistoryCategoryResolver(api),
  /**
   * Returns a TranslateCategoryResolver using the configured translation rules.
   * @param cfg - The full ImporterConfig containing translation rules.
   * @returns A new TranslateCategoryResolver.
   */
  translate: (cfg) => new TranslateCategoryResolver(cfg.categorization?.translations ?? []),
};

/**
 * Creates the appropriate ICategoryResolver based on the categorization mode in config.
 * @param cfg - The ImporterConfig containing categorization settings.
 * @returns The resolver for the configured mode, or undefined for mode 'none'.
 */
function createCategoryResolver(cfg: ImporterConfig): ICategoryResolver | undefined {
  const mode = cfg.categorization?.mode ?? 'none';
  return (resolverFactories[mode] ?? resolverFactories.none)(cfg);
}

// Initialize services
const isDryRun = process.env.DRY_RUN === 'true';
const dryRunCollector = new DryRunCollector();
const categoryResolver = createCategoryResolver(config);
const transactionService = new TransactionService(api, categoryResolver);
const reconciliationService = new ReconciliationService(api);
const metrics = new MetricsService();
const auditLog = new AuditLogService();
const notificationService = new NotificationService(config.notifications);

// Initialize 2FA service if Telegram is configured
const telegram = config.notifications?.telegram;
const telegramNotifier = telegram ? new TelegramNotifier(telegram) : null;

logger.info('🚀 Starting Israeli Bank Importer for Actual Budget\n');
if (isDryRun) logger.info('🔍 DRY RUN MODE — no changes will be made to Actual Budget\n');
if (config.proxy?.server) logger.info(`🌐 Using proxy: ${config.proxy.server}`);

// Company type mapping
const companyTypeMap: Record<string, typeof CompanyTypes[keyof typeof CompanyTypes]> = {
  'hapoalim': CompanyTypes.Hapoalim,
  'leumi': CompanyTypes.Leumi,
  'discount': CompanyTypes.Discount,
  'mizrahi': CompanyTypes.Mizrahi,
  'mercantile': CompanyTypes.Mercantile,
  'otsarHahayal': CompanyTypes.OtsarHahayal,
  'otsarhahayal': CompanyTypes.OtsarHahayal,
  'beinleumi': CompanyTypes.Beinleumi,
  'massad': CompanyTypes.Massad,
  'yahav': CompanyTypes.Yahav,
  'visaCal': CompanyTypes.VisaCal,
  'visacal': CompanyTypes.VisaCal,
  'max': CompanyTypes.Max,
  'isracard': CompanyTypes.Isracard,
  'amex': CompanyTypes.Amex,
  'beyahadBishvilha': CompanyTypes.BeyahadBishvilha,
  'beyahadbishvilha': CompanyTypes.BeyahadBishvilha,
  'behatsdaa': CompanyTypes.Behatsdaa,
  'pagi': CompanyTypes.Pagi,
  'oneZero': CompanyTypes.OneZero,
  'onezero': CompanyTypes.OneZero
};

// Reconciliation status messages (OCP — add new statuses without changing logic)
const reconciliationMessages: Record<string, (diff: number) => string> = {
  /**
   * Formats a reconciliation message with the signed ILS adjustment amount.
   * @param diff - The reconciliation diff in cents.
   * @returns Formatted reconciliation log string.
   */
  created: (diff) =>
    `     ✅ Reconciled: ${diff > 0 ? '+' : ''}${(diff / 100).toFixed(2)} ILS`,
  /**
   * Returns the "already balanced" status message.
   * @returns Log string for a balanced account.
   */
  skipped: () => `     ✅ Already balanced`,
  /**
   * Returns the "already reconciled today" status message.
   * @returns Log string for an already-reconciled account.
   */
  'already-reconciled': () => `     ✅ Already reconciled today`,
};

// OCP: scraper error type → user-friendly suffix
const scrapeErrorHints: Record<string, string> = {
  WAF_BLOCKED: '. WAF blocked the request — wait 1-2 hours before retrying',
  CHANGE_PASSWORD: '. The bank requires a password change — log in via browser first',
  ACCOUNT_BLOCKED: '. Your account is blocked — contact your bank',
  INVALID_OTP: '. OTP rejected — the code may have expired. Enter it quickly next time',
};

// Bank responses that mean "0 transactions in range" — not a real failure
// Some scrapers return success:false with these messages instead of an empty accounts array
const NO_RECORDS_PATTERNS = [
  'no transactions found',
  'no results found',
  'לא מצאנו תנועות', // Discount: "no transactions found" in Hebrew
];

/**
 * Checks whether a scraper failure indicates "no transactions found" vs. a real error.
 * @param result - The ScraperScrapingResult to inspect.
 * @returns True when the error message matches a known "empty result" pattern.
 */
function isEmptyResultError(result: ScraperScrapingResult): boolean {
  const msg = (result.errorMessage ?? '').toLowerCase();
  return NO_RECORDS_PATTERNS.some(p => msg.includes(p.toLowerCase()));
}

/**
 * Logs a scraper failure with a user-friendly hint based on the error type.
 * @param bankName - The name of the bank that failed to scrape.
 * @param result - The failed ScraperScrapingResult containing error details.
 */
function logScrapeFailure(bankName: string, result: ScraperScrapingResult): void {
  const hint = scrapeErrorHints[result.errorType ?? ''] ?? '';
  logger.error(
    `  ❌ Failed to scrape ${bankName}: ${result.errorMessage || 'Unknown error'}${hint}`
  );
}

// ─── Scraper helpers ───

/**
 * Computes the transaction start date for a bank based on daysBack or startDate config.
 * @param bankConfig - The BankConfig whose date settings to use.
 * @returns The computed start Date for transaction scraping.
 */
function computeStartDate(bankConfig: BankConfig): Date {
  if (bankConfig.daysBack) {
    const date = new Date();
    date.setDate(date.getDate() - (bankConfig.daysBack - 1));
    return date;
  }
  return bankConfig.startDate ? new Date(bankConfig.startDate) : new Date();
}


/**
 * Filters a transaction list to only include transactions on or after the configured start date.
 * @param txns - Raw BankTransaction array from the scraper.
 * @param bankConfig - Bank config providing daysBack or startDate cutoff.
 * @returns Filtered array, or the original array if no date filter is configured.
 */
function filterTransactionsByDate(
  txns: BankTransaction[], bankConfig: BankConfig
): BankTransaction[] {
  if (!bankConfig.daysBack && !bankConfig.startDate) return txns;
  return filterByDateCutoff(txns, formatDate(computeStartDate(bankConfig)));
}

/**
 * Logs the effective date range being used for scraping based on the bank config.
 * @param bankConfig - The BankConfig whose date settings to display.
 */
function logDateRange(bankConfig: BankConfig): void {
  if (bankConfig.daysBack) {
    const startDate = computeStartDate(bankConfig);
    logger.info(
      `  📅 Date range: last ${bankConfig.daysBack} days ` +
      `(from ${formatDate(startDate)})`
    );
  } else if (bankConfig.startDate) {
    logger.info(`  📅 Date range: from ${bankConfig.startDate} to today`);
  } else {
    logger.info(`  📅 Date range: using bank default (usually ~1 year)`);
  }
}

/**
 * Builds the ScraperOptions object for a bank scrape.
 * @param companyType - The CompanyTypes enum value for the target bank.
 * @param bankConfig - The bank's configuration (timeout, navigationRetryCount, etc.).
 * @param otpRetriever - Optional async OTP code provider for 2FA banks.
 * @returns Configured ScraperOptions ready for createScraper().
 */
function buildScraperOptions(
  companyType: typeof CompanyTypes[keyof typeof CompanyTypes],
  bankConfig: BankConfig,
  otpRetriever?: () => Promise<string>
): ScraperOptions {
  return {
    companyId: companyType,
    startDate: computeStartDate(bankConfig),
    args: buildChromeArgs(config.proxy),
    defaultTimeout: bankConfig.timeout ?? 60_000,
    ...(bankConfig.navigationRetryCount
      ? { navigationRetryCount: bankConfig.navigationRetryCount }
      : {}),
    ...(otpRetriever
      ? {
        /**
         * Delegates to the injected otpRetriever, ignoring the phone hint.
         * @param _phoneHint - Phone hint from the scraper (not used).
         * @returns Promise resolving to the OTP code string.
         */
        otpCodeRetriever: (_phoneHint: string) => otpRetriever()
      }
      : {}),
  };
}

/**
 * Deletes the stored Chrome browser session data for a bank to force a clean login.
 * @param bankName - The bank whose Chrome data directory should be cleared.
 */
function clearBankSession(bankName: string): void {
  const bankDir = getChromeDataDir(bankName);
  if (!existsSync(bankDir)) return;
  logger.info(`  🧹 Clearing browser session for ${bankName}`);
  try { rmSync(bankDir, { recursive: true, force: true }); }
  catch { logger.warn(`  ⚠️  Failed to clear session for ${bankName}`); }
}

/**
 * Creates a Telegram-based OTP retriever for 2FA banks when configured.
 * @param bankName - The bank name used in the Telegram prompt message.
 * @param bankConfig - The BankConfig whose twoFactorAuth flag and timeout are read.
 * @returns An async OTP retriever function, or undefined if 2FA is not needed.
 */
function buildOtpRetriever(
  bankName: string, bankConfig: BankConfig
): (() => Promise<string>) | undefined {
  if (!bankConfig.twoFactorAuth || bankConfig.otpLongTermToken || !telegramNotifier) {
    return undefined;
  }
  const twoFactor = new TwoFactorService(telegramNotifier, bankConfig.twoFactorTimeout);
  logger.info(`  🔐 2FA enabled for ${bankName} (via Telegram)`);
  return twoFactor.createOtpRetriever(bankName);
}

// ─── Mock scraper for E2E testing ───

/**
 * Reads and parses a mock scraper JSON file for E2E testing.
 * @param filePath - Absolute path to the mock JSON file.
 * @returns Parsed ScraperScrapingResult ready to use in place of a real scrape.
 */
function parseMockFile(filePath: string): ScraperScrapingResult {
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  const data = parsed as { success?: boolean; accounts?: unknown[] };
  if (typeof data.success !== 'boolean' || !Array.isArray(data.accounts)) {
    throw new Error(`Invalid mock scraper file: missing success or accounts`);
  }
  return data as ScraperScrapingResult;
}

/**
 * Resolves which mock scraper file to use for a given bank in E2E test mode.
 * @param bankName - The bank name used to look for a per-bank mock file.
 * @returns Path to the mock JSON file, or null if mock mode is not active.
 */
function resolveMockFile(bankName: string): string | null {
  const mockDir = process.env.E2E_MOCK_SCRAPER_DIR;
  if (mockDir) {
    const bankFile = `${mockDir}/${bankName}.json`;
    return existsSync(bankFile) ? bankFile : `${mockDir}/default.json`;
  }
  return process.env.E2E_MOCK_SCRAPER_FILE ?? null;
}

/**
 * Loads a mock scraper result for a bank when E2E mock env vars are set.
 * @param bankName - The bank whose mock data file to load.
 * @returns The parsed ScraperScrapingResult, or null if mock mode is inactive.
 */
function loadMockScraperResult(bankName: string): ScraperScrapingResult | null {
  const file = resolveMockFile(bankName);
  if (!file) return null;
  logger.info(`  🧪 Using mock scraper data from ${file}`);
  return parseMockFile(file);
}

// ─── Scraper orchestration ───

/**
 * Optionally clears the bank session, logs the date range, and creates a scraper.
 * @param bankConfig - Bank configuration used for session clearing and logging.
 * @param bankName - The bank name used for logging.
 * @param options - ScraperOptions to pass to createScraper.
 * @returns The newly created scraper instance.
 */
function prepareScraper(
  bankConfig: BankConfig, bankName: string, options: ScraperOptions
): ReturnType<typeof createScraper> {
  if (bankConfig.clearSession) clearBankSession(bankName);
  logger.info(`  🔧 Creating scraper for ${bankName}...`);
  logDateRange(bankConfig);
  return createScraper(options);
}

/**
 * Looks up the company type, builds the OTP retriever, and creates the scraper + credentials.
 * @param bankName - The bank key used to look up the CompanyTypes enum value.
 * @param bankConfig - The bank's full configuration.
 * @returns Object with the initialized scraper and its credentials.
 */
function initBankScrape(
  bankName: string, bankConfig: BankConfig
): { scraper: ReturnType<typeof createScraper>; credentials: ScraperCredentials } {
  const companyType = companyTypeMap[bankName.toLowerCase()];
  if (!companyType) throw new Error(`Unknown bank: ${bankName}`);
  const otpRetriever = buildOtpRetriever(bankName, bankConfig);
  return {
    scraper: prepareScraper(bankConfig, bankName,
      buildScraperOptions(companyType, bankConfig, otpRetriever)),
    credentials: buildCredentials(bankConfig, otpRetriever),
  };
}

/**
 * Performs a single scrape attempt for a bank, applying the appropriate retry strategy.
 * @param bankName - The bank to scrape.
 * @param bankConfig - The bank's configuration (twoFactorAuth flag affects retry strategy).
 * @returns The ScraperScrapingResult from the attempt.
 */
async function executeScrapeAttempt(
  bankName: string, bankConfig: BankConfig
): Promise<ScraperScrapingResult> {
  const { scraper, credentials } = initBankScrape(bankName, bankConfig);
  const strategy = bankConfig.twoFactorAuth ? noRetryStrategy : retryStrategy;
  return strategy.execute(
    () => timeoutWrapper.wrap(
      scraper.scrape(credentials),
      DEFAULT_RESILIENCE_CONFIG.scrapingTimeoutMs,
      `Scraping ${bankName}`
    ),
    `Scraping ${bankName}`
  );
}

/**
 * Notifies the user that an OTP was rejected and retries the scrape with a fresh code.
 * @param bankName - The bank whose OTP was rejected.
 * @param bankConfig - The bank's configuration for the retry attempt.
 * @returns The ScraperScrapingResult from the retry attempt.
 */
async function retryOtpScrape(
  bankName: string, bankConfig: BankConfig
): Promise<ScraperScrapingResult> {
  logger.warn(`  ⚠️  OTP rejected — requesting a new code for ${bankName}`);
  await notificationService.sendMessage(
    `⚠️ OTP for <b>${bankName}</b> was rejected. ` +
    `A new code will be requested — please check your SMS.`
  );
  return executeScrapeAttempt(bankName, bankConfig);
}

/**
 * Orchestrates scraping a bank: uses mock data in E2E mode, retries on INVALID_OTP.
 * @param bankName - The bank to scrape.
 * @param bankConfig - The bank's configuration.
 * @returns The final ScraperScrapingResult after resilience handling.
 */
async function scrapeBankWithResilience(
  bankName: string, bankConfig: BankConfig
): Promise<ScraperScrapingResult> {
  const mockResult = loadMockScraperResult(bankName);
  if (mockResult) return mockResult;
  logger.info(`  🔍 Scraping transactions from ${bankName}...`);
  const result = await executeScrapeAttempt(bankName, bankConfig);
  if (!result.success && String(result.errorType) === 'INVALID_OTP') {
    return retryOtpScrape(bankName, bankConfig);
  }
  return result;
}

// ─── Account processing context types ───

interface ImportTxnCtx {
  bankName: string;
  accountNumber: string;
  accountName?: string;
  actualAccountId: string;
  balance: number | undefined;
  currency: string;
}

interface ReconcileCtx {
  actualAccountId: string;
  balance: number | undefined;
  currency: string;
  bankName: string;
}

interface AccountInfo {
  accountNumber: string;
  accountName?: string;
  balance: number | undefined;
  currency: string;
  txnCount: number;
}

// ─── Account processing helpers ───

/**
 * Finds the BankTarget configured for a given account number.
 * @param bankConfig - The BankConfig whose targets list to search.
 * @param accountNumber - The account number to match against each target's accounts field.
 * @returns The matching BankTarget, or undefined if no target covers this account.
 */
function findTargetForAccount(
  bankConfig: BankConfig, accountNumber: string
): BankTarget | undefined {
  return bankConfig.targets?.find(t =>
    t.accounts === 'all' || (Array.isArray(t.accounts) && t.accounts.includes(accountNumber))
  );
}

/**
 * Imports transactions into Actual Budget and records the result in MetricsService.
 * @param ctx - Context with bank name, account number, account ID, balance, and currency.
 * @param txns - The BankTransaction array to import.
 * @returns ImportResult with new/skipped counts, or null if the array is empty.
 */
async function importAndRecordTransactions(
  ctx: ImportTxnCtx, txns: BankTransaction[]
): Promise<ImportResult | null> {
  if (!txns || txns.length === 0) return null;
  const opts: ImportTransactionsOpts = {
    bankName: ctx.bankName, accountNumber: ctx.accountNumber,
    actualAccountId: ctx.actualAccountId, transactions: txns,
  };
  const result = await transactionService.importTransactions(opts);
  metrics.recordAccountTransactions(ctx.bankName, {
    accountNumber: ctx.accountNumber, accountName: ctx.accountName,
    balance: ctx.balance, currency: ctx.currency,
    newTransactions: result.newTransactions, existingTransactions: result.existingTransactions,
  });
  return result;
}

/**
 * Runs reconciliation for an account when the target's reconcile flag is true and balance is known.
 * @param target - The BankTarget whose reconcile flag and account ID are used.
 * @param ctx - Context with the actual account ID, balance, currency, and bank name.
 */
async function reconcileIfConfigured(target: BankTarget, ctx: ReconcileCtx): Promise<void> {
  if (!target.reconcile || ctx.balance === undefined) return;
  logger.info(`     🔄 Reconciling account balance...`);
  try {
    const result = await reconciliationService.reconcile(
      ctx.actualAccountId, ctx.balance, ctx.currency
    );
    metrics.recordReconciliation(ctx.bankName, result.status, result.diff);
    logger.info(reconciliationMessages[result.status](result.diff));
  } catch (error: unknown) {
    logger.error(`     ❌ Reconciliation error: ${errorMessage(error)}`);
  }
}

/**
 * Imports transactions for one account and then runs reconciliation if configured.
 * @param target - The BankTarget with account ID, reconcile flag, and optional name.
 * @param account - Account data from the scraper.
 * @param account.accountNumber - The bank account number.
 * @param account.balance - Optional scraped balance in currency units.
 * @param account.txns - Transactions to import.
 * @param bankCtx - Bank name and currency context.
 * @param bankCtx.bankName - The bank name for metrics and logging.
 * @param bankCtx.currency - Currency code for reconciliation.
 * @returns ImportResult with new/skipped counts, or null if no transactions.
 */
async function importAndReconcile(
  target: BankTarget,
  account: { accountNumber: string; balance?: number; txns: BankTransaction[] },
  bankCtx: { bankName: string; currency: string }
): Promise<ImportResult | null> {
  const ctx: ImportTxnCtx = {
    bankName: bankCtx.bankName, accountNumber: account.accountNumber,
    accountName: target.accountName, actualAccountId: target.actualAccountId,
    balance: account.balance, currency: bankCtx.currency,
  };
  const result = await importAndRecordTransactions(ctx, account.txns);
  await reconcileIfConfigured(target, {
    actualAccountId: target.actualAccountId,
    balance: account.balance, currency: bankCtx.currency, bankName: bankCtx.bankName,
  });
  return result;
}

/**
 * Processes one scraped account: finds its target, imports (or dry-runs), and reconciles.
 * @param bankCtx - Bank name, config, and currency context.
 * @param bankCtx.bankName - The bank name for metrics and logging.
 * @param bankCtx.bankConfig - Full bank configuration used for target lookup.
 * @param bankCtx.currency - Currency code for this account.
 * @param account - Account data from the scraper.
 * @param account.accountNumber - The bank account number.
 * @param account.balance - Optional scraped balance in currency units.
 * @param account.txns - Transactions to import.
 * @returns Counts of imported and skipped transactions.
 */
async function processAccount(
  bankCtx: { bankName: string; bankConfig: BankConfig; currency: string },
  account: { accountNumber: string; balance?: number; txns: BankTransaction[] }
): Promise<{ imported: number; skipped: number }> {
  const { bankName, bankConfig, currency } = bankCtx;
  const target = findTargetForAccount(bankConfig, account.accountNumber);
  if (!target) {
    logger.warn(`     ⚠️  No target configured for this account, skipping`);
    return { imported: 0, skipped: 0 };
  }
  if (isDryRun) return collectDryRunAccount(bankName, account, currency);
  await transactionService.getOrCreateAccount(
    target.actualAccountId, bankName, account.accountNumber
  );
  const result = await importAndReconcile(target, account, { bankName, currency });
  return { imported: result?.imported ?? 0, skipped: result?.skipped ?? 0 };
}

/**
 * Records an account preview in the DryRunCollector instead of importing.
 * @param bankName - The bank this account belongs to.
 * @param account - Account data from the scraper.
 * @param account.accountNumber - The bank account number.
 * @param account.balance - Optional scraped balance in currency units.
 * @param account.txns - Transactions found by the scraper.
 * @param currency - Currency code for the account.
 * @returns Always {imported: 0, skipped: 0} in dry-run mode.
 */
function collectDryRunAccount(
  bankName: string,
  account: { accountNumber: string; balance?: number; txns: BankTransaction[] },
  currency: string
): { imported: number; skipped: number } {
  const preview = DryRunCollector.buildPreview({
    bankName, accountNumber: account.accountNumber,
    balance: account.balance, currency, txns: account.txns,
  });
  dryRunCollector.recordAccount(preview);
  return { imported: 0, skipped: 0 };
}

// ─── Bank import orchestration ───

/**
 * Logs account balance and transaction count before processing.
 * @param info - Structured account info to display in the log.
 */
function logAccountInfo(info: AccountInfo): void {
  const label = info.accountName
    ? `${info.accountName} (${info.accountNumber})`
    : info.accountNumber;
  logger.info(`\n  💳 Processing account: ${label}`);
  const bal = info.balance !== undefined ? `${info.balance} ${info.currency}` : 'N/A';
  logger.info(`     Balance: ${bal}`);
  logger.info(`     Transactions: ${info.txnCount}`);
}

/**
 * Filters transactions by date, logs account info, and delegates to processAccount.
 * @param bankCtx - Bank name, config, and currency context.
 * @param bankCtx.bankName - The bank name for metrics and logging.
 * @param bankCtx.bankConfig - Full bank config for date filtering and target lookup.
 * @param bankCtx.currency - Currency code for this account.
 * @param account - Raw account data from the scraper.
 * @param account.accountNumber - The bank account number.
 * @param account.balance - Optional scraped balance in currency units.
 * @param account.txns - Unfiltered transactions from the scraper.
 * @returns Counts of imported and skipped transactions after date filtering.
 */
async function processOneAccount(
  bankCtx: { bankName: string; bankConfig: BankConfig; currency: string },
  account: { accountNumber: string; balance?: number; txns: BankTransaction[] }
): Promise<{ imported: number; skipped: number }> {
  const target = findTargetForAccount(bankCtx.bankConfig, account.accountNumber);
  const txns = filterTransactionsByDate(account.txns ?? [], bankCtx.bankConfig);
  logAccountInfo({
    accountNumber: account.accountNumber, accountName: target?.accountName,
    balance: account.balance, currency: bankCtx.currency, txnCount: txns.length,
  });
  return processAccount(bankCtx, { ...account, txns });
}

/**
 * Iterates all accounts in a scrape result and processes each one.
 * @param bankName - The bank whose accounts are being processed.
 * @param bankConfig - The bank's configuration used for date filtering and targets.
 * @param scrapeResult - The full scraper result containing all account data.
 * @returns Aggregated totals of imported and skipped transactions.
 */
async function processAllAccounts(
  bankName: string, bankConfig: BankConfig, scrapeResult: ScraperScrapingResult
): Promise<{ imported: number; skipped: number }> {
  let totalImported = 0, totalSkipped = 0;
  for (const account of scrapeResult.accounts ?? []) {
    if (shutdownHandler.isShuttingDown()) {
      logger.warn('  ⚠️  Shutdown requested, stopping import...'); break;
    }
    const currency = account.txns[0]?.originalCurrency || 'ILS';
    const counts = await processOneAccount({ bankName, bankConfig, currency }, account);
    totalImported += counts.imported;
    totalSkipped += counts.skipped;
  }
  return { imported: totalImported, skipped: totalSkipped };
}

/**
 * Logs that a bank was scraped successfully with its account count.
 * @param bankName - The name of the successfully scraped bank.
 * @param accountCount - Number of accounts found in the scrape result.
 */
function logBankScrapedInfo(bankName: string, accountCount: number): void {
  logger.info(`  ✅ Successfully scraped ${bankName}`);
  logger.info(`  📝 Found ${accountCount} accounts`);
}

/**
 * Handles a failed scrape result by logging the error and recording metrics.
 * @param bankName - The bank that failed to scrape.
 * @param result - The failed ScraperScrapingResult containing error details.
 */
function handleFailedScrape(bankName: string, result: ScraperScrapingResult): void {
  if (isEmptyResultError(result)) {
    logger.info(`  ✅ ${bankName}: no transactions in selected period`);
    metrics.recordBankSuccess(bankName, 0, 0);
    return;
  }
  logScrapeFailure(bankName, result);
  const rawMsg = result.errorMessage?.trim();
  const safeMsg = rawMsg && rawMsg !== 'undefined' ? rawMsg : 'Unknown error';
  metrics.recordBankFailure(bankName, new Error(safeMsg));
}

/**
 * Orchestrates the full import pipeline for one bank: scrape → process accounts → record metrics.
 * @param bankName - The bank key to import.
 * @param bankConfig - The bank's full configuration.
 */
async function importFromBank(bankName: string, bankConfig: BankConfig): Promise<void> {
  logger.info(`\n📊 Processing ${bankName}...`);
  metrics.startBank(bankName);
  try {
    const scrapeResult = await scrapeBankWithResilience(bankName, bankConfig);
    if (!scrapeResult.success) {
      handleFailedScrape(bankName, scrapeResult);
      return;
    }
    logBankScrapedInfo(bankName, scrapeResult.accounts?.length ?? 0);
    const totals = await processAllAccounts(bankName, bankConfig, scrapeResult);
    metrics.recordBankSuccess(bankName, totals.imported, totals.skipped);
    logger.info(`\n✅ Completed ${bankName}`);
  } catch (error) {
    metrics.recordBankFailure(bankName, error as Error);
    logger.error(errorFormatter.format(error as Error, bankName));
    if (error instanceof Error) logger.error(`Stack trace: ${error.stack}`);
  }
}

// ─── Main orchestration ───

/**
 * Initializes the Actual Budget API in local mode using a local budget ID (E2E testing).
 */
async function initializeLocalBudget(): Promise<void> {
  const budgetId = process.env.E2E_LOCAL_BUDGET_ID ?? '';
  logger.info('🔌 Initializing Actual Budget (local mode)...');
  await api.init({ dataDir: config.actual.init.dataDir });
  logger.info(`📂 Loading local budget: ${budgetId}`);
  await api.loadBudget(budgetId);
}

/**
 * Connects to the Actual Budget server and downloads the configured budget.
 */
async function initializeServerBudget(): Promise<void> {
  logger.info('🔌 Connecting to Actual Budget...');
  const { dataDir, serverURL, password } = config.actual.init;
  await api.init({ dataDir, serverURL, password });
  logger.info('✅ Connected to Actual Budget server');
  logger.info(`📂 Loading budget: ${config.actual.budget.syncId}`);
  await api.downloadBudget(
    config.actual.budget.syncId,
    { password: config.actual.budget.password || undefined }
  );
}

/**
 * Initializes the Actual Budget API in either local or server mode based on env vars.
 */
async function initializeApi(): Promise<void> {
  if (process.env.E2E_LOCAL_BUDGET_ID) { await initializeLocalBudget(); }
  else { await initializeServerBudget(); }
  logger.info('✅ Budget loaded successfully\n');
  logger.info('='.repeat(60));
}

/**
 * Filters the bank list by the IMPORT_BANKS environment variable when set.
 * @param all - Full list of [bankName, BankConfig] entries from config.
 * @returns Filtered list matching the IMPORT_BANKS names, or the full list if unset.
 */
function applyBankFilter(all: [string, BankConfig][]): [string, BankConfig][] {
  const filter = process.env.IMPORT_BANKS?.split(',').map(b => b.trim()).filter(Boolean);
  if (!filter?.length) return all;
  const filtered = all.filter(([n]) => filter.some(f => f.toLowerCase() === n.toLowerCase()));
  logger.info(`  🔍 Bank filter: ${filtered.map(([n]) => n).join(', ')}`);
  return filtered;
}

/**
 * Iterates all configured banks (after filter) and runs importFromBank for each.
 */
async function processAllBanks(): Promise<void> {
  const banks = applyBankFilter(Object.entries(config.banks || {}));
  for (let i = 0; i < banks.length; i++) {
    if (shutdownHandler.isShuttingDown()) {
      logger.warn('⚠️  Shutdown requested, stopping imports...'); break;
    }
    if (i > 0) await delayBeforeNextBank(config.delayBetweenBanks);
    await importFromBank(banks[i][0], banks[i][1]);
  }
}

/**
 * Waits for the configured delay between bank imports when delayBetweenBanks is set.
 * @param delayMs - Optional delay in milliseconds; no delay if zero or undefined.
 */
async function delayBeforeNextBank(delayMs?: number): Promise<void> {
  if (!delayMs || delayMs <= 0) return;
  logger.info(`\n⏳ Waiting ${(delayMs / 1000).toFixed(0)}s before next bank...`);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

/**
 * Runs the SpendingWatchService and sends an alert notification if any rules are triggered.
 */
async function evaluateSpendingWatch(): Promise<void> {
  if (!config.spendingWatch?.length) return;
  logger.info('\n🔔 Evaluating spending watch rules...');
  const watchService = new SpendingWatchService(config.spendingWatch, api);
  const message = await watchService.evaluate();
  if (message) await notificationService.sendMessage(message);
  logger.info(message ? '⚠️  Spending watch alerts triggered' : '✅ All spending within limits');
}

/**
 * Records the import in the audit log and sends a summary notification (normal mode).
 */
async function finalizeNormalImport(): Promise<void> {
  auditLog.record(metrics.getSummary());
  await notificationService.sendSummary(metrics.getSummary());
  logger.info('\n🎉 Import process completed!\n');
}

/**
 * Logs the dry-run preview and sends it as a Telegram message (dry-run mode).
 */
async function finalizeDryRun(): Promise<void> {
  logger.info(dryRunCollector.formatText());
  logger.info('\n✅ No changes made to Actual Budget (dry run)\n');
  if (dryRunCollector.hasAccounts()) {
    await notificationService.sendMessage(dryRunCollector.formatTelegram());
  }
}

/**
 * Prints summary metrics, finalizes in normal or dry-run mode, shuts down the API, and exits.
 */
async function finalizeImport(): Promise<void> {
  metrics.printSummary();
  await (isDryRun ? finalizeDryRun() : finalizeNormalImport());
  await api.shutdown();
  process.exit(metrics.hasFailures() ? 1 : 0);
}

/**
 * Handles an unrecoverable error: logs it, sends a Telegram notification, and exits.
 * @param error - The unknown error caught at the top level.
 * @returns Never — always exits the process with code 1.
 */
async function handleFatalError(error: unknown): Promise<never> {
  const formattedError = errorFormatter.format(error as Error);
  logger.error('\n' + formattedError);
  if (error instanceof Error) logger.error(`Stack trace: ${error.stack}`);
  await notificationService.sendError(formattedError);
  try { await api.shutdown(); } catch { /* ignore shutdown error */ }
  process.exit(1);
}

/**
 * Main entry point: initialises the API, imports all banks, and finalises the run.
 */
async function main(): Promise<void> {
  try {
    shutdownHandler.onShutdown(async () => {
      logger.info('🔌 Shutting down Actual Budget API...');
      try { await api.shutdown(); }
      catch (e: unknown) { logger.error(`Error during API shutdown: ${errorMessage(e)}`); }
    });
    await initializeApi();
    if (!isDryRun) await categoryResolver?.initialize();
    metrics.startImport();
    await processAllBanks();
    if (!isDryRun) await evaluateSpendingWatch();
    await finalizeImport();
  } catch (error) {
    await handleFatalError(error);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
