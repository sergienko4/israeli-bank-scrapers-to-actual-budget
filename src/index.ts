/**
 * Israeli Bank Importer for Actual Budget
 * Main entry point with integrated resilience features
 */

import api from '@actual-app/api';
import { createScraper, CompanyTypes } from 'israeli-bank-scrapers';
import { ConfigLoader } from './config/ConfigLoader.js';
import { ErrorFormatter } from './errors/ErrorFormatter.js';
import { ExponentialBackoffRetry } from './resilience/RetryStrategy.js';
import { TimeoutWrapper } from './resilience/TimeoutWrapper.js';
import { GracefulShutdownHandler } from './resilience/GracefulShutdown.js';
import { ReconciliationService } from './services/ReconciliationService.js';
import { MetricsService } from './services/MetricsService.js';
import { TransactionService } from './services/TransactionService.js';
import { NotificationService } from './services/NotificationService.js';
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
const reconciliationService = new ReconciliationService(api);
const transactionService = new TransactionService(api);
const metrics = new MetricsService();

// Load configuration
const configLoader = new ConfigLoader();
const config: ImporterConfig = configLoader.load();
const notificationService = new NotificationService(config.notifications);

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

async function scrapeBankWithResilience(bankName: string, bankConfig: BankConfig): Promise<any> {
  const companyType = companyTypeMap[bankName.toLowerCase()];
  if (!companyType) {
    throw new Error(`Unknown bank: ${bankName}`);
  }

  console.log(`  🔧 Creating scraper for ${bankName}...`);

  const chromeDataDir = process.env.CHROME_DATA_DIR || '/app/chrome-data';
  const scraperConfig: any = {
    companyId: companyType,
    ...bankConfig,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      `--user-data-dir=${chromeDataDir}`
    ]
  };

  if (bankConfig.startDate) {
    console.log(`  📅 Date range: from ${bankConfig.startDate} to today`);
  } else {
    console.log(`  📅 Date range: using bank default (usually ~1 year)`);
  }

  const scraper = createScraper(scraperConfig);

  // Scrape with timeout and retry
  console.log(`  🔍 Scraping transactions from ${bankName}...`);

  return await retryStrategy.execute(
    async () => {
      return await timeoutWrapper.wrap(
        scraper.scrape(bankConfig as any),
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

      console.log(`\n  💳 Processing account: ${account.accountNumber} (${account.type})`);
      console.log(`     Balance: ${account.balance} ${account.currency || 'ILS'}`);
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
      }

      // Handle reconciliation
      if (target.reconcile && account.balance !== undefined) {
        console.log(`     🔄 Reconciling account balance...`);
        try {
          const result = await reconciliationService.reconcile(
            actualAccountId,
            account.balance,
            account.currency || 'ILS'
          );

          // Record reconciliation metrics
          metrics.recordReconciliation(bankName, result.status, result.diff);

          if (result.status === 'created') {
            const sign = result.diff > 0 ? '+' : '';
            console.log(`     ✅ Reconciled: ${sign}${(result.diff / 100).toFixed(2)} ILS`);
          } else if (result.status === 'skipped') {
            console.log(`     ✅ Already balanced`);
          } else {
            console.log(`     ✅ Already reconciled today (skipped duplicate)`);
          }
        } catch (error: any) {
          console.error(`     ❌ Reconciliation error:`, error.message);
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
