/**
 * Israeli Bank Importer for Actual Budget
 * Main entry point — coordinates all services.
 * Scraping is delegated to BankScraper; account processing to AccountImporter.
 */

import api from '@actual-app/api';
import type { ScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';
import { ConfigLoader } from './Config/ConfigLoader.js';
import { ErrorFormatter } from './Errors/ErrorFormatter.js';
import { ExponentialBackoffRetry } from './Resilience/RetryStrategy.js';
import { TimeoutWrapper } from './Resilience/TimeoutWrapper.js';
import { GracefulShutdownHandler } from './Resilience/GracefulShutdown.js';
import { MetricsService } from './Services/MetricsService.js';
import { TransactionService } from './Services/TransactionService.js';
import { ReconciliationService } from './Services/ReconciliationService.js';
import { NotificationService } from './Services/NotificationService.js';
import { AuditLogService } from './Services/AuditLogService.js';
import { TelegramNotifier } from './Services/Notifications/TelegramNotifier.js';
import type { ImporterConfig, BankConfig, CategorizationMode } from './Types/Index.js';
import { DEFAULT_RESILIENCE_CONFIG } from './Types/Index.js';
import { errorMessage } from './Utils/Index.js';
import { createLogger, getLogger, deriveLogFormat } from './Logger/Index.js';
import type { ICategoryResolver } from './Services/ICategoryResolver.js';
import { HistoryCategoryResolver } from './Services/HistoryCategoryResolver.js';
import { TranslateCategoryResolver } from './Services/TranslateCategoryResolver.js';
import { SpendingWatchService } from './Services/SpendingWatchService.js';
import { DryRunCollector } from './Services/DryRunCollector.js';
import {
  BankScraper, isEmptyResultError, logScrapeFailure
} from './Scraper/BankScraper.js';
import { AccountImporter } from './Services/AccountImporter.js';

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
const telegram = config.notifications?.telegram;
const telegramNotifier = telegram ? new TelegramNotifier(telegram) : null;

logger.info('🚀 Starting Israeli Bank Importer for Actual Budget\n');
if (isDryRun) logger.info('🔍 DRY RUN MODE — no changes will be made to Actual Budget\n');
if (config.proxy?.server) logger.info(`🌐 Using proxy: ${config.proxy.server}`);

// Wire up the two orchestration classes
const bankScraper = new BankScraper({
  config, retryStrategy, noRetryStrategy, timeoutWrapper,
  telegramNotifier, notificationService,
});
const accountImporter = new AccountImporter({
  transactionService, reconciliationService, metrics,
  isDryRun, dryRunCollector, shutdownHandler,
});

// ─── Bank import orchestration ───

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
 * Orchestrates the full import pipeline for one bank.
 * @param bankName - The bank key to import.
 * @param bankConfig - The bank's full configuration.
 */
async function importFromBank(bankName: string, bankConfig: BankConfig): Promise<void> {
  logger.info(`\n📊 Processing ${bankName}...`);
  metrics.startBank(bankName);
  try {
    const scrapeResult = await bankScraper.scrapeBankWithResilience(bankName, bankConfig);
    if (!scrapeResult.success) { handleFailedScrape(bankName, scrapeResult); return; }
    logBankScrapedInfo(bankName, scrapeResult.accounts?.length ?? 0);
    const totals = await accountImporter.processAllAccounts(bankName, bankConfig, scrapeResult);
    metrics.recordBankSuccess(bankName, totals.imported, totals.skipped);
    logger.info(`\n✅ Completed ${bankName}`);
  } catch (error) {
    metrics.recordBankFailure(bankName, error as Error);
    logger.error(errorFormatter.format(error as Error, bankName));
    if (error instanceof Error) logger.error(`Stack trace: ${error.stack}`);
  }
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
