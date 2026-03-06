/**
 * Account import orchestration extracted from Index.ts to keep it under 300 lines.
 */
import type { BankConfig, BankTarget, BankTransaction } from '../Types/Index.js';
import type { ScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';
import type {
  TransactionService, ImportResult, ImportTransactionsOpts
} from './TransactionService.js';
import type { ReconciliationService } from './ReconciliationService.js';
import type { MetricsService } from './MetricsService.js';
import type { IShutdownHandler } from '../Resilience/GracefulShutdown.js';
import { DryRunCollector } from './DryRunCollector.js';
import { errorMessage } from '../Utils/Index.js';
import { filterTransactionsByDate } from '../Scraper/BankScraper.js';
import { getLogger } from '../Logger/Index.js';

// Reconciliation status log messages (OCP — add entries without changing logic)
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

/** Internal context for importing one account's transactions. */
interface ImportTxnCtx {
  bankName: string;
  accountNumber: string;
  accountName?: string;
  actualAccountId: string;
  balance: number | undefined;
  currency: string;
}

/** Internal context for reconciling one account. */
interface ReconcileCtx {
  actualAccountId: string;
  balance: number | undefined;
  currency: string;
  bankName: string;
}

/** Options injected into AccountImporter for all account-processing operations. */
export interface AccountImporterOpts {
  /** Transaction service for importing and querying Actual Budget. */
  transactionService: TransactionService;
  /** Reconciliation service for balance adjustment transactions. */
  reconciliationService: ReconciliationService;
  /** Metrics service for recording per-bank and per-account stats. */
  metrics: MetricsService;
  /** Whether the current run is a dry run (no writes to Actual Budget). */
  isDryRun: boolean;
  /** Collector for dry-run account previews. */
  dryRunCollector: DryRunCollector;
  /** Shutdown handler for checking whether to abort mid-run. */
  shutdownHandler: IShutdownHandler;
}

/** Processes scraped accounts: imports transactions, reconciles balances, tracks metrics. */
export class AccountImporter {
  /**
   * Creates an AccountImporter with the given service dependencies.
   * @param opts - All services needed for account processing.
   */
  constructor(private readonly opts: AccountImporterOpts) {}

  /**
   * Iterates all accounts in a scrape result and processes each one.
   * @param bankName - The bank whose accounts are being processed.
   * @param bankConfig - The bank's configuration for date filtering and targets.
   * @param scrapeResult - The full scraper result containing all account data.
   * @returns Aggregated totals of imported and skipped transactions.
   */
  async processAllAccounts(
    bankName: string, bankConfig: BankConfig, scrapeResult: ScraperScrapingResult
  ): Promise<{ imported: number; skipped: number }> {
    let totalImported = 0, totalSkipped = 0;
    for (const account of scrapeResult.accounts ?? []) {
      if (this.opts.shutdownHandler.isShuttingDown()) {
        getLogger().warn('  ⚠️  Shutdown requested, stopping import...'); break;
      }
      const currency = account.txns[0]?.originalCurrency || 'ILS';
      const counts = await this.processOneAccount({ bankName, bankConfig, currency }, account);
      totalImported += counts.imported;
      totalSkipped += counts.skipped;
    }
    return { imported: totalImported, skipped: totalSkipped };
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
  private async processOneAccount(
    bankCtx: { bankName: string; bankConfig: BankConfig; currency: string },
    account: { accountNumber: string; balance?: number; txns: BankTransaction[] }
  ): Promise<{ imported: number; skipped: number }> {
    const target = this.findTargetForAccount(bankCtx.bankConfig, account.accountNumber);
    const txns = filterTransactionsByDate(account.txns ?? [], bankCtx.bankConfig);
    this.logAccountInfo({
      accountNumber: account.accountNumber, accountName: target?.accountName,
      balance: account.balance, currency: bankCtx.currency, txnCount: txns.length,
    });
    return this.processAccount(bankCtx, { ...account, txns });
  }

  /**
   * Processes one account: finds its target, imports or dry-runs, and reconciles.
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
  private async processAccount(
    bankCtx: { bankName: string; bankConfig: BankConfig; currency: string },
    account: { accountNumber: string; balance?: number; txns: BankTransaction[] }
  ): Promise<{ imported: number; skipped: number }> {
    const { bankName, bankConfig, currency } = bankCtx;
    const target = this.findTargetForAccount(bankConfig, account.accountNumber);
    if (!target) {
      getLogger().warn(`     ⚠️  No target configured for this account, skipping`);
      return { imported: 0, skipped: 0 };
    }
    if (this.opts.isDryRun) return this.collectDryRunAccount(bankName, account, currency);
    await this.opts.transactionService.getOrCreateAccount(
      target.actualAccountId, bankName, account.accountNumber
    );
    const result = await this.importAndReconcile(target, account, { bankName, currency });
    return { imported: result?.imported ?? 0, skipped: result?.skipped ?? 0 };
  }

  /**
   * Imports transactions and then reconciles the account balance if configured.
   * @param target - The BankTarget with account ID and reconcile flag.
   * @param account - Account data from the scraper.
   * @param account.accountNumber - The bank account number.
   * @param account.balance - Optional scraped balance in currency units.
   * @param account.txns - Transactions to import.
   * @param bankCtx - Bank name and currency context.
   * @param bankCtx.bankName - The bank name for metrics.
   * @param bankCtx.currency - Currency code for reconciliation.
   * @returns ImportResult with new/skipped counts, or null if no transactions.
   */
  private async importAndReconcile(
    target: BankTarget,
    account: { accountNumber: string; balance?: number; txns: BankTransaction[] },
    bankCtx: { bankName: string; currency: string }
  ): Promise<ImportResult | null> {
    const ctx: ImportTxnCtx = {
      bankName: bankCtx.bankName, accountNumber: account.accountNumber,
      accountName: target.accountName, actualAccountId: target.actualAccountId,
      balance: account.balance, currency: bankCtx.currency,
    };
    const result = await this.importAndRecordTransactions(ctx, account.txns);
    await this.reconcileIfConfigured(target, {
      actualAccountId: target.actualAccountId,
      balance: account.balance, currency: bankCtx.currency, bankName: bankCtx.bankName,
    });
    return result;
  }

  /**
   * Imports transactions into Actual Budget and records the result in MetricsService.
   * @param ctx - Context with bank name, account number, account ID, balance, and currency.
   * @param txns - The BankTransaction array to import.
   * @returns ImportResult with new/skipped counts, or null if the array is empty.
   */
  private async importAndRecordTransactions(
    ctx: ImportTxnCtx, txns: BankTransaction[]
  ): Promise<ImportResult | null> {
    if (!txns || txns.length === 0) return null;
    const opts: ImportTransactionsOpts = {
      bankName: ctx.bankName, accountNumber: ctx.accountNumber,
      actualAccountId: ctx.actualAccountId, transactions: txns,
    };
    const result = await this.opts.transactionService.importTransactions(opts);
    this.opts.metrics.recordAccountTransactions(ctx.bankName, {
      accountNumber: ctx.accountNumber, accountName: ctx.accountName,
      balance: ctx.balance, currency: ctx.currency,
      newTransactions: result.newTransactions, existingTransactions: result.existingTransactions,
    });
    return result;
  }

  /**
   * Runs reconciliation when the target's reconcile flag is true and balance is known.
   * @param target - The BankTarget whose reconcile flag and account ID are used.
   * @param ctx - Context with the actual account ID, balance, currency, and bank name.
   */
  private async reconcileIfConfigured(target: BankTarget, ctx: ReconcileCtx): Promise<void> {
    if (!target.reconcile || ctx.balance === undefined) return;
    getLogger().info(`     🔄 Reconciling account balance...`);
    try {
      const result = await this.opts.reconciliationService.reconcile(
        ctx.actualAccountId, ctx.balance, ctx.currency
      );
      this.opts.metrics.recordReconciliation(ctx.bankName, result.status, result.diff);
      getLogger().info(reconciliationMessages[result.status](result.diff));
    } catch (error: unknown) {
      getLogger().error(`     ❌ Reconciliation error: ${errorMessage(error)}`);
    }
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
  private collectDryRunAccount(
    bankName: string,
    account: { accountNumber: string; balance?: number; txns: BankTransaction[] },
    currency: string
  ): { imported: number; skipped: number } {
    const preview = DryRunCollector.buildPreview({
      bankName, accountNumber: account.accountNumber,
      balance: account.balance, currency, txns: account.txns,
    });
    this.opts.dryRunCollector.recordAccount(preview);
    return { imported: 0, skipped: 0 };
  }

  /**
   * Finds the BankTarget configured for a given account number.
   * @param bankConfig - The BankConfig whose targets list to search.
   * @param accountNumber - The account number to match.
   * @returns The matching BankTarget, or undefined if none covers this account.
   */
  private findTargetForAccount(
    bankConfig: BankConfig, accountNumber: string
  ): BankTarget | undefined {
    return bankConfig.targets?.find(t =>
      t.accounts === 'all' || (Array.isArray(t.accounts) && t.accounts.includes(accountNumber))
    );
  }

  /**
   * Logs account balance and transaction count before processing.
   * @param info - Structured account info to display.
   * @param info.accountNumber - The bank account number.
   * @param info.accountName - Optional account display name.
   * @param info.balance - Optional account balance.
   * @param info.currency - Currency code.
   * @param info.txnCount - Number of transactions to be processed.
   */
  private logAccountInfo(info: {
    accountNumber: string; accountName?: string;
    balance: number | undefined; currency: string; txnCount: number;
  }): void {
    const label = info.accountName
      ? `${info.accountName} (${info.accountNumber})` : info.accountNumber;
    getLogger().info(`\n  💳 Processing account: ${label}`);
    const bal = info.balance !== undefined ? `${info.balance} ${info.currency}` : 'N/A';
    getLogger().info(`     Balance: ${bal}`);
    getLogger().info(`     Transactions: ${info.txnCount}`);
  }
}
