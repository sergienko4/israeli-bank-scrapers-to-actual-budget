import api from '@actual-app/api';
import { createScraper, CompanyTypes } from 'israeli-bank-scrapers';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load configuration from file or environment variables
function loadConfig() {
  const configPath = join(__dirname, 'config.json');

  // Try to load from config.json first
  if (existsSync(configPath)) {
    try {
      console.log('📄 Loading configuration from config.json');
      return JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (error) {
      console.warn('⚠️  Failed to parse config.json, falling back to environment variables');
    }
  } else {
    console.log('📄 config.json not found, using environment variables');
  }

  // Build config from environment variables
  const config = {
    actual: {
      init: {
        dataDir: process.env.ACTUAL_DATA_DIR || './data',
        password: process.env.ACTUAL_PASSWORD,
        serverURL: process.env.ACTUAL_SERVER_URL || 'http://actual_server:5006'
      },
      budget: {
        syncId: process.env.ACTUAL_BUDGET_SYNC_ID,
        password: process.env.ACTUAL_BUDGET_PASSWORD || null
      }
    },
    banks: {}
  };

  // Add Discount bank if credentials are provided
  if (process.env.DISCOUNT_ID) {
    config.banks.discount = {
      id: process.env.DISCOUNT_ID,
      password: process.env.DISCOUNT_PASSWORD,
      num: process.env.DISCOUNT_NUM,
      startDate: process.env.DISCOUNT_START_DATE,
      targets: [{
        actualAccountId: process.env.DISCOUNT_ACCOUNT_ID,
        reconcile: process.env.DISCOUNT_RECONCILE === 'true',
        accounts: process.env.DISCOUNT_ACCOUNTS || 'all'
      }]
    };
  }

  // Add Leumi bank if credentials are provided
  if (process.env.LEUMI_USERNAME) {
    config.banks.leumi = {
      username: process.env.LEUMI_USERNAME,
      password: process.env.LEUMI_PASSWORD,
      startDate: process.env.LEUMI_START_DATE,
      targets: [{
        actualAccountId: process.env.LEUMI_ACCOUNT_ID,
        reconcile: process.env.LEUMI_RECONCILE === 'true',
        accounts: process.env.LEUMI_ACCOUNTS || 'all'
      }]
    };
  }

  // Add Hapoalim bank if credentials are provided
  if (process.env.HAPOALIM_USER_CODE) {
    config.banks.hapoalim = {
      userCode: process.env.HAPOALIM_USER_CODE,
      password: process.env.HAPOALIM_PASSWORD,
      startDate: process.env.HAPOALIM_START_DATE,
      targets: [{
        actualAccountId: process.env.HAPOALIM_ACCOUNT_ID,
        reconcile: process.env.HAPOALIM_RECONCILE === 'true',
        accounts: process.env.HAPOALIM_ACCOUNTS || 'all'
      }]
    };
  }

  // Validate required config
  if (!config.actual.init.password) {
    throw new Error('ACTUAL_PASSWORD is required (set via environment variable or config.json)');
  }
  if (!config.actual.budget.syncId) {
    throw new Error('ACTUAL_BUDGET_SYNC_ID is required (set via environment variable or config.json)');
  }
  if (Object.keys(config.banks).length === 0) {
    throw new Error('No bank credentials configured. Please set environment variables or use config.json');
  }

  return config;
}

const config = loadConfig();

console.log('🚀 Starting Israeli Bank Importer for Actual Budget\n');

// Helper function to format date as YYYY-MM-DD
function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper function to convert amount to cents
function toCents(amount) {
  return Math.round(amount * 100);
}

// Main import function
async function importFromBank(bankName, bankConfig) {
  console.log(`\n📊 Processing ${bankName}...`);

  try {
    // Map bank names to CompanyTypes
    const companyTypeMap = {
      // Banks
      'hapoalim': CompanyTypes.hapoalim,
      'leumi': CompanyTypes.leumi,
      'discount': CompanyTypes.discount,
      'mizrahi': CompanyTypes.mizrahi,
      'mercantile': CompanyTypes.mercantile,
      'otsarHahayal': CompanyTypes.otsarHahayal,
      'otsarhahayal': CompanyTypes.otsarHahayal, // alternate casing
      'union': CompanyTypes.union,
      'beinleumi': CompanyTypes.beinleumi,
      'massad': CompanyTypes.massad,
      'yahav': CompanyTypes.yahav,
      // Credit Cards
      'visaCal': CompanyTypes.visaCal,
      'visacal': CompanyTypes.visaCal, // alternate casing
      'max': CompanyTypes.max,
      'isracard': CompanyTypes.isracard,
      'amex': CompanyTypes.amex,
      'beyahadBishvilha': CompanyTypes.beyahadBishvilha,
      'beyahadbishvilha': CompanyTypes.beyahadBishvilha, // alternate casing
      'behatsdaa': CompanyTypes.behatsdaa,
      'pagi': CompanyTypes.pagi,
      'oneZero': CompanyTypes.oneZero,
      'onezero': CompanyTypes.oneZero // alternate casing
    };

    const companyType = companyTypeMap[bankName.toLowerCase()];
    if (!companyType) {
      throw new Error(`Unknown bank: ${bankName}`);
    }

    // Create scraper instance with Docker-compatible browser options
    console.log(`  🔧 Creating scraper for ${bankName}...`);

    // Set up Chrome data directory for 2FA persistence
    const chromeDataDir = process.env.CHROME_DATA_DIR || '/app/chrome-data';

    const scraperConfig = {
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

    // Log date range if specified
    if (bankConfig.startDate) {
      console.log(`  📅 Date range: from ${bankConfig.startDate} to today`);
    } else {
      console.log(`  📅 Date range: using bank default (usually ~1 year)`);
    }

    const scraper = createScraper(scraperConfig);

    // Scrape transactions
    console.log(`  🔍 Scraping transactions from ${bankName}...`);
    const scrapeResult = await scraper.scrape(bankConfig);

    if (!scrapeResult.success) {
      console.error(`  ❌ Failed to scrape ${bankName}:`, scrapeResult.errorMessage || 'Unknown error');
      return;
    }

    console.log(`  ✅ Successfully scraped ${bankName}`);
    console.log(`  📝 Found ${scrapeResult.accounts?.length || 0} accounts`);

    // Process each account
    for (const account of scrapeResult.accounts || []) {
      console.log(`\n  💳 Processing account: ${account.accountNumber} (${account.type})`);
      console.log(`     Balance: ${account.balance} ${account.currency || 'ILS'}`);
      console.log(`     Transactions: ${account.txns?.length || 0}`);

      // Find corresponding Actual account
      const target = bankConfig.targets?.find(t =>
        t.accounts === 'all' ||
        (Array.isArray(t.accounts) && t.accounts.includes(account.accountNumber))
      );

      if (!target) {
        console.log(`     ⚠️  No target configured for this account, skipping`);
        continue;
      }

      const actualAccountId = target.actualAccountId;

      // Get or create account in Actual Budget
      let actualAccount = await api.getAccounts().then(accounts =>
        accounts.find(a => a.id === actualAccountId)
      );

      if (!actualAccount) {
        console.log(`     ➕ Creating new account: ${actualAccountId}`);
        actualAccount = await api.createAccount({
          id: actualAccountId,
          name: `${bankName} - ${account.accountNumber}`,
          type: account.type === 'creditCard' ? 'credit' : 'checking'
        });
      }

      // Import transactions
      if (account.txns && account.txns.length > 0) {
        console.log(`     📥 Importing ${account.txns.length} transactions...`);

        let imported = 0;
        let skipped = 0;

        for (const txn of account.txns) {
          try {
            // Create unique ID for duplicate detection
            const importedId = `${bankName}-${account.accountNumber}-${txn.identifier || `${formatDate(txn.date)}-${txn.chargedAmount || txn.originalAmount}`}`;

            // Convert transaction to Actual Budget format
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
          } catch (error) {
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
          // Get current balance in Actual
          const actualBalance = await api.runQuery(
            api.q('transactions')
              .filter({ account: actualAccountId })
              .calculate({ $sum: '$amount' })
          ).then(result => result.data || 0);

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
        } catch (error) {
          console.error(`     ❌ Reconciliation error:`, error.message);
        }
      }
    }

    console.log(`\n✅ Completed ${bankName}`);
  } catch (error) {
    console.error(`❌ Error processing ${bankName}:`, error.message);
    console.error(error.stack);
  }
}

// Main execution
async function main() {
  try {
    // Initialize Actual Budget API
    console.log('🔌 Connecting to Actual Budget...');
    await api.init({
      dataDir: config.actual.init.dataDir || './data',
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
    console.log('=' .repeat(60));

    // Process each bank
    for (const [bankName, bankConfig] of Object.entries(config.banks || {})) {
      await importFromBank(bankName, bankConfig);
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 All imports completed successfully!\n');

    // Shutdown
    await api.shutdown();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
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
