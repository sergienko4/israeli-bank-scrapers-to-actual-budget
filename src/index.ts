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
import { TransactionService } from './services/TransactionService.js';
import { ReconciliationService } from './services/ReconciliationService.js';
import { NotificationService } from './services/NotificationService.js';
import { TwoFactorService } from './services/TwoFactorService.js';
import { TelegramNotifier } from './services/notifications/TelegramNotifier.js';
import { ImporterConfig, BankConfig, DEFAULT_RESILIENCE_CONFIG } from './types/index.js';

// Initialize resilience components
const shutdownHandler = new GracefulShutdownHandler();
const retryStrategy = new ExponentialBackoffRetry({
  maxAttempts: DEFAULT_RESILIENCE_CONFIG.maxRetryAttempts,
  initialBackoffMs: DEFAULT_RESILIENCE_CONFIG.initialBackoffMs,
  shouldShutdown: () => shutdownHandler.isShuttingDown()
});
const timeoutWrapper = new TimeoutWrapper();
const errorFormatter = new ErrorFormatter();
const transactionService = new TransactionService(api);
const reconciliationService = new ReconciliationService(api);
const metrics = new MetricsService();

// Load configuration
const configLoader = new ConfigLoader();
const config: ImporterConfig = configLoader.load();
const notificationService = new NotificationService(config.notifications);

// Initialize 2FA service if Telegram is configured
const telegram = config.notifications?.telegram;
const telegramNotifier = telegram ? new TelegramNotifier(telegram) : null;

console.log('🚀 Starting Israeli Bank Importer for Actual Budget\n');

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
    console.log(`  📅 Date range: last ${bankConfig.daysBack} days (from ${startDate.toISOString().split('T')[0]})`);
  } else if (bankConfig.startDate) {
    console.log(`  📅 Date range: from ${bankConfig.startDate} to today`);
  } else {
    console.log(`  📅 Date range: using bank default (usually ~1 year)`);
  }
}

async function scrapeBankWithResilience(bankName: string, bankConfig: BankConfig): Promise<ScraperScrapingResult> {
  const companyType = companyTypeMap[bankName.toLowerCase()];
  if (!companyType) {
    throw new Error(`Unknown bank: ${bankName}`);
  }

  console.log(`  🔧 Creating scraper for ${bankName}...`);

  const chromeDataDir = process.env.CHROME_DATA_DIR || '/app/chrome-data';
  const scraperOptions: ScraperOptions = {
    companyId: companyType,
    startDate: computeStartDate(bankConfig),
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      `--user-data-dir=${chromeDataDir}`
    ]
  };

  logDateRange(bankConfig);

  // Build credentials; inject 2FA if bank has twoFactorAuth enabled and no long-term token
  let otpRetriever: (() => Promise<string>) | undefined;
  if (bankConfig.twoFactorAuth && !bankConfig.otpLongTermToken && telegramNotifier) {
    const twoFactor = new TwoFactorService(telegramNotifier, bankConfig.twoFactorTimeout);
    otpRetriever = twoFactor.createOtpRetriever(bankName);
    console.log(`  🔐 2FA enabled for ${bankName} (via Telegram)`);
  }
  const credentials = buildCredentials(bankConfig, otpRetriever);

  const scraper = createScraper(scraperOptions);

  console.log(`  🔍 Scraping transactions from ${bankName}...`);

  return await retryStrategy.execute(
    async () => {
      return await timeoutWrapper.wrap(
        scraper.scrape(credentials),
        DEFAULT_RESILIENCE_CONFIG.scrapingTimeoutMs,
        `Scraping ${bankName}`
      );
    },
    `Scraping ${bankName}`
  );
}

async function importFromBank(bankName: string, bankConfig: BankConfig): Promise<void> {
  console.log(`\n📊 Processing ${bankName}...`);
  metrics.startBank(bankName);

  // Track metrics across all accounts for this bank
  let totalImported = 0;
  let totalSkipped = 0;

  try {
    const scrapeResult = await scrapeBankWithResilience(bankName, bankConfig);

    if (!scrapeResult.success) {
      console.error(`  ❌ Failed to scrape ${bankName}:`, scrapeResult.errorMessage || 'Unknown error');
      return;
    }

    console.log(`  ✅ Successfully scraped ${bankName}`);
    console.log(`  📝 Found ${scrapeResult.accounts?.length || 0} accounts`);

    // Process each account
    for (const account of scrapeResult.accounts || []) {
      if (shutdownHandler.isShuttingDown()) {
        console.log('  ⚠️  Shutdown requested, stopping import...');
        break;
      }

      const currency = account.txns[0]?.originalCurrency || 'ILS';
      console.log(`\n  💳 Processing account: ${account.accountNumber}`);
      console.log(`     Balance: ${account.balance} ${currency}`);
      console.log(`     Transactions: ${account.txns?.length || 0}`);

      const target = bankConfig.targets?.find(t =>
        t.accounts === 'all' ||
        (Array.isArray(t.accounts) && t.accounts.includes(account.accountNumber))
      );

      if (!target) {
        console.log(`     ⚠️  No target configured for this account, skipping`);
        continue;
      }

      const actualAccountId = target.actualAccountId;

      // Get or create account
      await transactionService.getOrCreateAccount(actualAccountId, bankName, account.accountNumber);

      // Import transactions
      if (account.txns && account.txns.length > 0) {
        const result = await transactionService.importTransactions(
          bankName, account.accountNumber, actualAccountId, account.txns
        );
        totalImported += result.imported;
        totalSkipped += result.skipped;

        // Record transaction details for notifications
        metrics.recordAccountTransactions(
          bankName, account.accountNumber,
          account.balance, currency,
          result.newTransactions, result.existingTransactions
        );
      }

      // Reconcile balance if configured
      if (target.reconcile && account.balance !== undefined) {
        console.log(`     🔄 Reconciling account balance...`);
        try {
          const result = await reconciliationService.reconcile(
            actualAccountId, account.balance, currency
          );
          metrics.recordReconciliation(bankName, result.status, result.diff);

          const statusMsg: Record<string, string> = {
            created: `     ✅ Reconciled: ${result.diff > 0 ? '+' : ''}${(result.diff / 100).toFixed(2)} ILS`,
            skipped: `     ✅ Already balanced`,
            'already-reconciled': `     ✅ Already reconciled today`,
          };
          console.log(statusMsg[result.status]);
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`     ❌ Reconciliation error:`, msg);
        }
      }
    }

    // Record bank success metrics
    metrics.recordBankSuccess(bankName, totalImported, totalSkipped);
    console.log(`\n✅ Completed ${bankName}`);
  } catch (error) {
    // Record bank failure metrics
    metrics.recordBankFailure(bankName, error as Error);
    const formattedError = errorFormatter.format(error as Error, bankName);
    console.error(formattedError);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
  }
}

async function main(): Promise<void> {
  try {
    // Register shutdown callback
    shutdownHandler.onShutdown(async () => {
      console.log('🔌 Shutting down Actual Budget API...');
      try {
        await api.shutdown();
      } catch (error) {
        console.error('Error during API shutdown:', error);
      }
    });

    // Initialize Actual Budget API
    console.log('🔌 Connecting to Actual Budget...');
    await api.init({
      dataDir: config.actual.init.dataDir,
      serverURL: config.actual.init.serverURL,
      password: config.actual.init.password,
    });

    console.log('✅ Connected to Actual Budget server');

    // Load budget
    console.log(`📂 Loading budget: ${config.actual.budget.syncId}`);
    await api.downloadBudget(config.actual.budget.syncId, {
      password: config.actual.budget.password || undefined
    });

    console.log('✅ Budget loaded successfully\n');
    console.log('='.repeat(60));

    // Start metrics collection
    metrics.startImport();

    // Process each bank
    for (const [bankName, bankConfig] of Object.entries(config.banks || {})) {
      if (shutdownHandler.isShuttingDown()) {
        console.log('⚠️  Shutdown requested, stopping imports...');
        break;
      }

      await importFromBank(bankName, bankConfig);
    }

    // Print metrics summary
    metrics.printSummary();

    // Send notification
    await notificationService.sendSummary(metrics.getSummary());

    console.log('\n🎉 Import process completed!\n');

    // Shutdown
    await api.shutdown();

    // Exit with appropriate code based on metrics
    process.exit(metrics.hasFailures() ? 1 : 0);

  } catch (error) {
    const formattedError = errorFormatter.format(error as Error);
    console.error('\n' + formattedError);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
    await notificationService.sendError(formattedError);
    try {
      await api.shutdown();
    } catch {}
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
