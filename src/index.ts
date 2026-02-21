/**
 * Israeli Bank Importer for Actual Budget
 * Main entry point with integrated resilience features
 */

import api from '@actual-app/api';
import { createScraper, CompanyTypes, ScraperOptions, ScraperCredentials, ScraperScrapingResult } from 'israeli-bank-scrapers';
import { ConfigLoader } from './config/ConfigLoader.js';
import { ErrorFormatter } from './errors/ErrorFormatter.js';
import { ExponentialBackoffRetry } from './resilience/RetryStrategy.js';
import { TimeoutWrapper } from './resilience/TimeoutWrapper.js';
import { GracefulShutdownHandler } from './resilience/GracefulShutdown.js';
import { MetricsService } from './services/MetricsService.js';
import { TransactionService, ImportResult } from './services/TransactionService.js';
import { ReconciliationService } from './services/ReconciliationService.js';
import { NotificationService } from './services/NotificationService.js';
import { AuditLogService } from './services/AuditLogService.js';
import { TwoFactorService } from './services/TwoFactorService.js';
import { TelegramNotifier } from './services/notifications/TelegramNotifier.js';
import { ImporterConfig, BankConfig, BankTarget, BankTransaction, DEFAULT_RESILIENCE_CONFIG, CategorizationMode } from './types/index.js';
import { errorMessage } from './utils/index.js';
import { createLogger, getLogger } from './logger/index.js';
import { ICategoryResolver } from './services/ICategoryResolver.js';
import { HistoryCategoryResolver } from './services/HistoryCategoryResolver.js';
import { TranslateCategoryResolver } from './services/TranslateCategoryResolver.js';
import { SpendingWatchService } from './services/SpendingWatchService.js';

// Load configuration and initialize logger
const configLoader = new ConfigLoader();
const config: ImporterConfig = configLoader.load();
createLogger(config.logConfig);
const logger = getLogger();

// Initialize resilience components
const shutdownHandler = new GracefulShutdownHandler();
const retryStrategy = new ExponentialBackoffRetry({
  maxAttempts: DEFAULT_RESILIENCE_CONFIG.maxRetryAttempts,
  initialBackoffMs: DEFAULT_RESILIENCE_CONFIG.initialBackoffMs,
  shouldShutdown: () => shutdownHandler.isShuttingDown()
});
const timeoutWrapper = new TimeoutWrapper();
const errorFormatter = new ErrorFormatter();

// ─── Category resolver (OCP dispatch) ───

const resolverFactories: Record<CategorizationMode, (cfg: ImporterConfig) => ICategoryResolver | undefined> = {
  none: () => undefined,
  history: () => new HistoryCategoryResolver(api),
  translate: (cfg) => new TranslateCategoryResolver(cfg.categorization?.translations ?? []),
};

function createCategoryResolver(cfg: ImporterConfig): ICategoryResolver | undefined {
  const mode = cfg.categorization?.mode ?? 'none';
  return (resolverFactories[mode] ?? resolverFactories.none)(cfg);
}

// Initialize services
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

// Company type mapping
const companyTypeMap: Record<string, typeof CompanyTypes[keyof typeof CompanyTypes]> = {
  'hapoalim': CompanyTypes.hapoalim,
  'leumi': CompanyTypes.leumi,
  'discount': CompanyTypes.discount,
  'mizrahi': CompanyTypes.mizrahi,
  'mercantile': CompanyTypes.mercantile,
  'otsarHahayal': CompanyTypes.otsarHahayal,
  'otsarhahayal': CompanyTypes.otsarHahayal,
  'union': CompanyTypes.union,
  'beinleumi': CompanyTypes.beinleumi,
  'massad': CompanyTypes.massad,
  'yahav': CompanyTypes.yahav,
  'visaCal': CompanyTypes.visaCal,
  'visacal': CompanyTypes.visaCal,
  'max': CompanyTypes.max,
  'isracard': CompanyTypes.isracard,
  'amex': CompanyTypes.amex,
  'beyahadBishvilha': CompanyTypes.beyahadBishvilha,
  'beyahadbishvilha': CompanyTypes.beyahadBishvilha,
  'behatsdaa': CompanyTypes.behatsdaa,
  'pagi': CompanyTypes.pagi,
  'oneZero': CompanyTypes.oneZero,
  'onezero': CompanyTypes.oneZero
};

// Reconciliation status messages (OCP — add new statuses without changing logic)
const reconciliationMessages: Record<string, (diff: number) => string> = {
  created: (diff) => `     ✅ Reconciled: ${diff > 0 ? '+' : ''}${(diff / 100).toFixed(2)} ILS`,
  skipped: () => `     ✅ Already balanced`,
  'already-reconciled': () => `     ✅ Already reconciled today`,
};

// ─── Scraper helpers ───

function computeStartDate(bankConfig: BankConfig): Date {
  if (bankConfig.daysBack) {
    const date = new Date();
    date.setDate(date.getDate() - bankConfig.daysBack);
    return date;
  }
  return bankConfig.startDate ? new Date(bankConfig.startDate) : new Date();
}

function buildCredentials(bankConfig: BankConfig, otpRetriever?: () => Promise<string>): ScraperCredentials {
  const { id, password, num, username, userCode, nationalID, card6Digits, email, phoneNumber, otpLongTermToken } = bankConfig;
  if (otpRetriever) {
    return { email: email!, password: password!, otpCodeRetriever: otpRetriever, phoneNumber: phoneNumber! } as ScraperCredentials;
  }
  if (otpLongTermToken) {
    return { email: email!, password: password!, otpLongTermToken } as ScraperCredentials;
  }
  return { id, password, num, username, userCode, nationalID, card6Digits, email, phoneNumber } as ScraperCredentials;
}

function logDateRange(bankConfig: BankConfig): void {
  if (bankConfig.daysBack) {
    const startDate = computeStartDate(bankConfig);
    logger.info(`  📅 Date range: last ${bankConfig.daysBack} days (from ${startDate.toISOString().split('T')[0]})`);
  } else if (bankConfig.startDate) {
    logger.info(`  📅 Date range: from ${bankConfig.startDate} to today`);
  } else {
    logger.info(`  📅 Date range: using bank default (usually ~1 year)`);
  }
}

function buildScraperOptions(companyType: typeof CompanyTypes[keyof typeof CompanyTypes], bankConfig: BankConfig): ScraperOptions {
  const chromeDataDir = process.env.CHROME_DATA_DIR || '/app/chrome-data';
  return {
    companyId: companyType,
    startDate: computeStartDate(bankConfig),
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', `--user-data-dir=${chromeDataDir}`]
  };
}

function buildOtpRetriever(bankName: string, bankConfig: BankConfig): (() => Promise<string>) | undefined {
  if (!bankConfig.twoFactorAuth || bankConfig.otpLongTermToken || !telegramNotifier) return undefined;
  const twoFactor = new TwoFactorService(telegramNotifier, bankConfig.twoFactorTimeout);
  logger.info(`  🔐 2FA enabled for ${bankName} (via Telegram)`);
  return twoFactor.createOtpRetriever(bankName);
}

// ─── Scraper orchestration ───

async function scrapeBankWithResilience(bankName: string, bankConfig: BankConfig): Promise<ScraperScrapingResult> {
  const companyType = companyTypeMap[bankName.toLowerCase()];
  if (!companyType) throw new Error(`Unknown bank: ${bankName}`);

  logger.info(`  🔧 Creating scraper for ${bankName}...`);
  const scraperOptions = buildScraperOptions(companyType, bankConfig);
  logDateRange(bankConfig);

  const credentials = buildCredentials(bankConfig, buildOtpRetriever(bankName, bankConfig));
  const scraper = createScraper(scraperOptions);
  logger.info(`  🔍 Scraping transactions from ${bankName}...`);

  return await retryStrategy.execute(
    async () => await timeoutWrapper.wrap(scraper.scrape(credentials), DEFAULT_RESILIENCE_CONFIG.scrapingTimeoutMs, `Scraping ${bankName}`),
    `Scraping ${bankName}`
  );
}

// ─── Account processing helpers ───

function findTargetForAccount(bankConfig: BankConfig, accountNumber: string): BankTarget | undefined {
  return bankConfig.targets?.find(t =>
    t.accounts === 'all' || (Array.isArray(t.accounts) && t.accounts.includes(accountNumber))
  );
}

async function importAndRecordTransactions(
  bankName: string, accountNumber: string, actualAccountId: string,
  txns: BankTransaction[], balance: number | undefined, currency: string
): Promise<ImportResult | null> {
  if (!txns || txns.length === 0) return null;
  const result = await transactionService.importTransactions(bankName, accountNumber, actualAccountId, txns);
  metrics.recordAccountTransactions(bankName, accountNumber, balance, currency, result.newTransactions, result.existingTransactions);
  return result;
}

async function reconcileIfConfigured(
  target: BankTarget, actualAccountId: string, balance: number | undefined, currency: string, bankName: string
): Promise<void> {
  if (!target.reconcile || balance === undefined) return;
  logger.info(`     🔄 Reconciling account balance...`);
  try {
    const result = await reconciliationService.reconcile(actualAccountId, balance, currency);
    metrics.recordReconciliation(bankName, result.status, result.diff);
    logger.info(reconciliationMessages[result.status](result.diff));
  } catch (error: unknown) {
    logger.error(`     ❌ Reconciliation error: ${errorMessage(error)}`);
  }
}

async function processAccount(
  bankName: string, bankConfig: BankConfig,
  account: { accountNumber: string; balance?: number; txns: BankTransaction[] }, currency: string
): Promise<{ imported: number; skipped: number }> {
  const target = findTargetForAccount(bankConfig, account.accountNumber);
  if (!target) { logger.warn(`     ⚠️  No target configured for this account, skipping`); return { imported: 0, skipped: 0 }; }

  await transactionService.getOrCreateAccount(target.actualAccountId, bankName, account.accountNumber);
  const result = await importAndRecordTransactions(bankName, account.accountNumber, target.actualAccountId, account.txns, account.balance, currency);
  await reconcileIfConfigured(target, target.actualAccountId, account.balance, currency, bankName);
  return { imported: result?.imported ?? 0, skipped: result?.skipped ?? 0 };
}

// ─── Bank import orchestration ───

function logAccountInfo(accountNumber: string, balance: number | undefined, currency: string, txnCount: number): void {
  logger.info(`\n  💳 Processing account: ${accountNumber}`);
  logger.info(`     Balance: ${balance} ${currency}`);
  logger.info(`     Transactions: ${txnCount}`);
}

async function processAllAccounts(
  bankName: string, bankConfig: BankConfig, scrapeResult: ScraperScrapingResult
): Promise<{ imported: number; skipped: number }> {
  let totalImported = 0, totalSkipped = 0;
  for (const account of scrapeResult.accounts || []) {
    if (shutdownHandler.isShuttingDown()) { logger.warn('  ⚠️  Shutdown requested, stopping import...'); break; }
    const currency = account.txns[0]?.originalCurrency || 'ILS';
    logAccountInfo(account.accountNumber, account.balance, currency, account.txns?.length || 0);
    const counts = await processAccount(bankName, bankConfig, account, currency);
    totalImported += counts.imported;
    totalSkipped += counts.skipped;
  }
  return { imported: totalImported, skipped: totalSkipped };
}

async function importFromBank(bankName: string, bankConfig: BankConfig): Promise<void> {
  logger.info(`\n📊 Processing ${bankName}...`);
  metrics.startBank(bankName);
  try {
    const scrapeResult = await scrapeBankWithResilience(bankName, bankConfig);
    if (!scrapeResult.success) { logger.error(`  ❌ Failed to scrape ${bankName}: ${scrapeResult.errorMessage || 'Unknown error'}`); return; }
    logger.info(`  ✅ Successfully scraped ${bankName}`);
    logger.info(`  📝 Found ${scrapeResult.accounts?.length || 0} accounts`);
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

async function initializeApi(): Promise<void> {
  logger.info('🔌 Connecting to Actual Budget...');
  await api.init({
    dataDir: config.actual.init.dataDir,
    serverURL: config.actual.init.serverURL,
    password: config.actual.init.password,
  });
  logger.info('✅ Connected to Actual Budget server');
  logger.info(`📂 Loading budget: ${config.actual.budget.syncId}`);
  await api.downloadBudget(config.actual.budget.syncId, { password: config.actual.budget.password || undefined });
  logger.info('✅ Budget loaded successfully\n');
  logger.info('='.repeat(60));
}

async function processAllBanks(): Promise<void> {
  const banks = Object.entries(config.banks || {});
  for (let i = 0; i < banks.length; i++) {
    if (shutdownHandler.isShuttingDown()) { logger.warn('⚠️  Shutdown requested, stopping imports...'); break; }
    if (i > 0) await delayBeforeNextBank(config.delayBetweenBanks);
    await importFromBank(banks[i][0], banks[i][1]);
  }
}

async function delayBeforeNextBank(delayMs?: number): Promise<void> {
  if (!delayMs || delayMs <= 0) return;
  logger.info(`\n⏳ Waiting ${(delayMs / 1000).toFixed(0)}s before next bank...`);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

async function evaluateSpendingWatch(): Promise<void> {
  if (!config.spendingWatch?.length) return;
  const watchService = new SpendingWatchService(config.spendingWatch, api);
  const message = await watchService.evaluate();
  if (message) await notificationService.sendMessage(message);
}

async function finalizeImport(): Promise<void> {
  metrics.printSummary();
  auditLog.record(metrics.getSummary());
  await notificationService.sendSummary(metrics.getSummary());
  logger.info('\n🎉 Import process completed!\n');
  await api.shutdown();
  process.exit(metrics.hasFailures() ? 1 : 0);
}

async function handleFatalError(error: unknown): Promise<never> {
  const formattedError = errorFormatter.format(error as Error);
  logger.error('\n' + formattedError);
  if (error instanceof Error) logger.error(`Stack trace: ${error.stack}`);
  await notificationService.sendError(formattedError);
  try { await api.shutdown(); } catch {}
  process.exit(1);
}

async function main(): Promise<void> {
  try {
    shutdownHandler.onShutdown(async () => {
      logger.info('🔌 Shutting down Actual Budget API...');
      try { await api.shutdown(); } catch (e: unknown) { logger.error(`Error during API shutdown: ${errorMessage(e)}`); }
    });
    await initializeApi();
    await categoryResolver?.initialize();
    metrics.startImport();
    await processAllBanks();
    await evaluateSpendingWatch();
    await finalizeImport();
  } catch (error) {
    await handleFatalError(error);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
