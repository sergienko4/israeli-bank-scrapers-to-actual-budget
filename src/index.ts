/**
 * Israeli Bank Importer for Actual Budget
 * Main entry point with integrated resilience features
 *
 * This file is the top-level orchestration module that coordinates all
 * services — a legitimate exception to the max-lines-per-file rule.
 */
/* eslint-disable max-lines */

import api from '@actual-app/api';
import {
  createScraper, CompanyTypes, ScraperOptions,
  ScraperCredentials, ScraperScrapingResult
} from '@sergienko4/israeli-bank-scrapers';
import { readFileSync, existsSync, rmSync } from 'fs';
import { ConfigLoader } from './Config/ConfigLoader.js';
import { ErrorFormatter } from './Errors/ErrorFormatter.js';
import { ExponentialBackoffRetry } from './Resilience/RetryStrategy.js';
import { TimeoutWrapper } from './Resilience/TimeoutWrapper.js';
import { GracefulShutdownHandler } from './Resilience/GracefulShutdown.js';
import { MetricsService } from './Services/MetricsService.js';
import {
  TransactionService, ImportResult, ImportTransactionsOpts
} from './Services/TransactionService.js';
import { ReconciliationService } from './Services/ReconciliationService.js';
import { NotificationService } from './Services/NotificationService.js';
import { AuditLogService } from './Services/AuditLogService.js';
import { TwoFactorService } from './Services/TwoFactorService.js';
import { TelegramNotifier } from './Services/Notifications/TelegramNotifier.js';
import {
  ImporterConfig, BankConfig, BankTarget,
  BankTransaction, DEFAULT_RESILIENCE_CONFIG, CategorizationMode
} from './Types/index.js';
import { buildChromeArgs, getChromeDataDir } from './Scraper/ScraperOptionsBuilder.js';
import { buildCredentials } from './Scraper/CredentialsBuilder.js';
import { errorMessage, formatDate } from './Utils/index.js';
import { createLogger, getLogger, deriveLogFormat } from './Logger/index.js';
import { ICategoryResolver } from './Services/ICategoryResolver.js';
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
  shouldShutdown: () => shutdownHandler.isShuttingDown(),
  shouldRetry: (error) => error.name !== 'WafBlockError',
});
// OTP banks must not retry — the OTP code is consumed on first use
const noRetryStrategy = new ExponentialBackoffRetry({
  maxAttempts: 1,
  initialBackoffMs: 0,
  shouldShutdown: () => shutdownHandler.isShuttingDown(),
});
const timeoutWrapper = new TimeoutWrapper();
const errorFormatter = new ErrorFormatter();

// ─── Category resolver (OCP dispatch) ───

const resolverFactories: Record<
  CategorizationMode, (cfg: ImporterConfig) => ICategoryResolver | undefined
> = {
  none: () => undefined,
  history: () => new HistoryCategoryResolver(api),
  translate: (cfg) => new TranslateCategoryResolver(cfg.categorization?.translations ?? []),
};

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
  'union': CompanyTypes.Union,
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
  created: (diff) =>
    `     ✅ Reconciled: ${diff > 0 ? '+' : ''}${(diff / 100).toFixed(2)} ILS`,
  skipped: () => `     ✅ Already balanced`,
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

function isEmptyResultError(result: ScraperScrapingResult): boolean {
  const msg = (result.errorMessage ?? '').toLowerCase();
  return NO_RECORDS_PATTERNS.some(p => msg.includes(p.toLowerCase()));
}

function logScrapeFailure(bankName: string, result: ScraperScrapingResult): void {
  const hint = scrapeErrorHints[result.errorType ?? ''] ?? '';
  logger.error(
    `  ❌ Failed to scrape ${bankName}: ${result.errorMessage || 'Unknown error'}${hint}`
  );
}

// ─── Scraper helpers ───

function computeStartDate(bankConfig: BankConfig): Date {
  if (bankConfig.daysBack) {
    const date = new Date();
    date.setDate(date.getDate() - (bankConfig.daysBack - 1));
    return date;
  }
  return bankConfig.startDate ? new Date(bankConfig.startDate) : new Date();
}


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
      ? { otpCodeRetriever: (_phoneHint: string) => otpRetriever() }
      : {}),
  };
}

function clearBankSession(bankName: string): void {
  const bankDir = getChromeDataDir(bankName);
  if (!existsSync(bankDir)) return;
  logger.info(`  🧹 Clearing browser session for ${bankName}`);
  try { rmSync(bankDir, { recursive: true, force: true }); }
  catch { logger.warn(`  ⚠️  Failed to clear session for ${bankName}`); }
}

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

function parseMockFile(filePath: string): ScraperScrapingResult {
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  const data = parsed as { success?: boolean; accounts?: unknown[] };
  if (typeof data.success !== 'boolean' || !Array.isArray(data.accounts)) {
    throw new Error(`Invalid mock scraper file: missing success or accounts`);
  }
  return data as ScraperScrapingResult;
}

function resolveMockFile(bankName: string): string | null {
  const mockDir = process.env.E2E_MOCK_SCRAPER_DIR;
  if (mockDir) {
    const bankFile = `${mockDir}/${bankName}.json`;
    return existsSync(bankFile) ? bankFile : `${mockDir}/default.json`;
  }
  return process.env.E2E_MOCK_SCRAPER_FILE ?? null;
}

function loadMockScraperResult(bankName: string): ScraperScrapingResult | null {
  const file = resolveMockFile(bankName);
  if (!file) return null;
  logger.info(`  🧪 Using mock scraper data from ${file}`);
  return parseMockFile(file);
}

// ─── Scraper orchestration ───

function prepareScraper(
  bankConfig: BankConfig, bankName: string, options: ScraperOptions
): ReturnType<typeof createScraper> {
  if (bankConfig.clearSession) clearBankSession(bankName);
  logger.info(`  🔧 Creating scraper for ${bankName}...`);
  logDateRange(bankConfig);
  return createScraper(options);
}

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

function findTargetForAccount(
  bankConfig: BankConfig, accountNumber: string
): BankTarget | undefined {
  return bankConfig.targets?.find(t =>
    t.accounts === 'all' || (Array.isArray(t.accounts) && t.accounts.includes(accountNumber))
  );
}

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

function logAccountInfo(info: AccountInfo): void {
  const label = info.accountName
    ? `${info.accountName} (${info.accountNumber})`
    : info.accountNumber;
  logger.info(`\n  💳 Processing account: ${label}`);
  const bal = info.balance !== undefined ? `${info.balance} ${info.currency}` : 'N/A';
  logger.info(`     Balance: ${bal}`);
  logger.info(`     Transactions: ${info.txnCount}`);
}

async function processAllAccounts(
  bankName: string, bankConfig: BankConfig, scrapeResult: ScraperScrapingResult
): Promise<{ imported: number; skipped: number }> {
  let totalImported = 0, totalSkipped = 0;
  for (const account of scrapeResult.accounts || []) {
    if (shutdownHandler.isShuttingDown()) {
      logger.warn('  ⚠️  Shutdown requested, stopping import...'); break;
    }
    const currency = account.txns[0]?.originalCurrency || 'ILS';
    const target = findTargetForAccount(bankConfig, account.accountNumber);
    logAccountInfo({
      accountNumber: account.accountNumber, accountName: target?.accountName,
      balance: account.balance, currency, txnCount: account.txns?.length || 0,
    });
    const counts = await processAccount({ bankName, bankConfig, currency }, account);
    totalImported += counts.imported;
    totalSkipped += counts.skipped;
  }
  return { imported: totalImported, skipped: totalSkipped };
}

function logBankScrapedInfo(bankName: string, accountCount: number): void {
  logger.info(`  ✅ Successfully scraped ${bankName}`);
  logger.info(`  📝 Found ${accountCount} accounts`);
}

function handleFailedScrape(bankName: string, result: ScraperScrapingResult): void {
  if (isEmptyResultError(result)) {
    logger.info(`  ✅ ${bankName}: no transactions in selected period`);
    metrics.recordBankSuccess(bankName, 0, 0);
    return;
  }
  logScrapeFailure(bankName, result);
  metrics.recordBankFailure(bankName, new Error(result.errorMessage || 'Unknown error'));
}

async function importFromBank(bankName: string, bankConfig: BankConfig): Promise<void> {
  logger.info(`\n📊 Processing ${bankName}...`);
  metrics.startBank(bankName);
  try {
    const scrapeResult = await scrapeBankWithResilience(bankName, bankConfig);
    if (!scrapeResult.success) {
      handleFailedScrape(bankName, scrapeResult);
      return;
    }
    logBankScrapedInfo(bankName, scrapeResult.accounts?.length || 0);
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

async function initializeLocalBudget(): Promise<void> {
  const budgetId = process.env.E2E_LOCAL_BUDGET_ID!;
  logger.info('🔌 Initializing Actual Budget (local mode)...');
  await api.init({ dataDir: config.actual.init.dataDir });
  logger.info(`📂 Loading local budget: ${budgetId}`);
  await api.loadBudget(budgetId);
}

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

async function initializeApi(): Promise<void> {
  if (process.env.E2E_LOCAL_BUDGET_ID) { await initializeLocalBudget(); }
  else { await initializeServerBudget(); }
  logger.info('✅ Budget loaded successfully\n');
  logger.info('='.repeat(60));
}

function applyBankFilter(all: [string, BankConfig][]): [string, BankConfig][] {
  const filter = process.env.IMPORT_BANKS?.split(',').map(b => b.trim()).filter(Boolean);
  if (!filter?.length) return all;
  const filtered = all.filter(([n]) => filter.some(f => f.toLowerCase() === n.toLowerCase()));
  logger.info(`  🔍 Bank filter: ${filtered.map(([n]) => n).join(', ')}`);
  return filtered;
}

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

async function delayBeforeNextBank(delayMs?: number): Promise<void> {
  if (!delayMs || delayMs <= 0) return;
  logger.info(`\n⏳ Waiting ${(delayMs / 1000).toFixed(0)}s before next bank...`);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

async function evaluateSpendingWatch(): Promise<void> {
  if (!config.spendingWatch?.length) return;
  logger.info('\n🔔 Evaluating spending watch rules...');
  const watchService = new SpendingWatchService(config.spendingWatch, api);
  const message = await watchService.evaluate();
  if (message) await notificationService.sendMessage(message);
  logger.info(message ? '⚠️  Spending watch alerts triggered' : '✅ All spending within limits');
}

async function finalizeNormalImport(): Promise<void> {
  auditLog.record(metrics.getSummary());
  await notificationService.sendSummary(metrics.getSummary());
  logger.info('\n🎉 Import process completed!\n');
}

async function finalizeDryRun(): Promise<void> {
  logger.info(dryRunCollector.formatText());
  logger.info('\n✅ No changes made to Actual Budget (dry run)\n');
  if (dryRunCollector.hasAccounts()) {
    await notificationService.sendMessage(dryRunCollector.formatTelegram());
  }
}

async function finalizeImport(): Promise<void> {
  metrics.printSummary();
  await (isDryRun ? finalizeDryRun() : finalizeNormalImport());
  await api.shutdown();
  process.exit(metrics.hasFailures() ? 1 : 0);
}

async function handleFatalError(error: unknown): Promise<never> {
  const formattedError = errorFormatter.format(error as Error);
  logger.error('\n' + formattedError);
  if (error instanceof Error) logger.error(`Stack trace: ${error.stack}`);
  await notificationService.sendError(formattedError);
  try { await api.shutdown(); } catch { /* ignore shutdown error */ }
  process.exit(1);
}

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
