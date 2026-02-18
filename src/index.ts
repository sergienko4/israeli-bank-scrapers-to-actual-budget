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

// Load configuration
const configLoader = new ConfigLoader();
const config: ImporterConfig = configLoader.load();

console.log('🚀 Starting Israeli Bank Importer for Actual Budget\n');

// Helper functions
function formatDate(date: Date | string): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

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
      let actualAccount = await api.getAccounts().then((accounts: any[]) =>
        accounts.find((a: any) => a.id === actualAccountId)
      );

      if (!actualAccount) {
        console.log(`     ➕ Creating new account: ${actualAccountId}`);
        actualAccount = await api.createAccount({
          id: actualAccountId,
          name: `${bankName} - ${account.accountNumber}`,
          offbudget: false,
          closed: false
        } as any);
      }

      // Import transactions
      if (account.txns && account.txns.length > 0) {
        console.log(`     📥 Importing ${account.txns.length} transactions...`);

        let imported = 0;
        let skipped = 0;

        for (const txn of account.txns) {
          try {
            const importedId = `${bankName}-${account.accountNumber}-${txn.identifier || `${formatDate(txn.date)}-${txn.chargedAmount || txn.originalAmount}`}`;

            const transaction = {
              account: actualAccountId,
              date: formatDate(txn.date),
              amount: toCents(txn.chargedAmount || txn.originalAmount),
              payee_name: txn.description || 'Unknown',
              imported_id: importedId,
              notes: txn.memo || txn.description || '',
              cleared: true
            };

            await api.importTransactions(actualAccountId, [transaction]);
            imported++;
          } catch (error: any) {
            if (error.message && error.message.includes('already exists')) {
              skipped++;
            } else {
              console.error(`     ❌ Error importing transaction:`, error.message);
            }
          }
        }

        console.log(`     ✅ Imported: ${imported}, Skipped (duplicates): ${skipped}`);
      }

      // Handle reconciliation
      if (target.reconcile && account.balance !== undefined) {
        console.log(`     🔄 Creating reconciliation transaction...`);
        try {
          const actualBalance = await api.runQuery(
            api.q('transactions')
              .filter({ account: actualAccountId })
              .calculate({ $sum: '$amount' })
          ).then((result: any) => result.data || 0);

          const expectedBalance = toCents(account.balance);
          const diff = expectedBalance - actualBalance;

          if (Math.abs(diff) > 0) {
            await api.addTransactions(actualAccountId, [{
              date: formatDate(new Date()),
              amount: diff,
              payee_name: 'Reconciliation',
              notes: `Balance adjustment: Expected ${account.balance} ${account.currency || 'ILS'}`,
              cleared: true
            }]);
            console.log(`     ✅ Reconciled: ${diff > 0 ? '+' : ''}${(diff / 100).toFixed(2)}`);
          } else {
            console.log(`     ✅ Already balanced`);
          }
        } catch (error: any) {
          console.error(`     ❌ Reconciliation error:`, error.message);
        }
      }
    }

    console.log(`\n✅ Completed ${bankName}`);
  } catch (error) {
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

    // Process each bank
    for (const [bankName, bankConfig] of Object.entries(config.banks || {})) {
      if (shutdownHandler.isShuttingDown()) {
        console.log('⚠️  Shutdown requested, stopping imports...');
        break;
      }

      await importFromBank(bankName, bankConfig);
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 All imports completed successfully!\n');

    // Shutdown
    await api.shutdown();
    process.exit(0);

  } catch (error) {
    const formattedError = errorFormatter.format(error as Error);
    console.error('\n' + formattedError);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
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
