/**
 * Account import orchestration extracted from Index.ts to keep it under 300 lines.
 */
import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import { getLogger } from '../Logger/Index.js';
import type { IShutdownHandler } from '../Resilience/GracefulShutdown.js';
import { filterTransactionsByDate } from '../Scraper/BankScraper.js';
import type { IBankConfig, IBankTarget, IBankTransaction, Procedure } from '../Types/Index.js';
import { isFail } from '../Types/Index.js';
import { DryRunCollector } from './DryRunCollector.js';
import type { MetricsService } from './MetricsService.js';
import type { ReconciliationService } from './ReconciliationService.js';
import type {
IImportResult, IImportTransactionsOpts,
  TransactionService} from './TransactionService.js';

// Reconciliation status log messages (OCP — add entries without changing logic)
const RECONCILIATION_MESSAGES: Record<string, (diff: number) => string> = {
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
  skipped: () => '     ✅ Already balanced',
  /**
   * Returns the "already reconciled today" status message.
   * @returns Log string for an already-reconciled account.
   */
  ['already-reconciled']: () => '     ✅ Already reconciled today',
};

/** Internal context for importing one account's transactions. */
interface IImportTxnCtx {
  bankName: string;
  accountNumber: string;
  accountName?: string;
  actualAccountId: string;
  balance: number | undefined;
  currency: string;
}

/** Internal context for reconciling one account. */
interface IReconcileCtx {
  actualAccountId: string;
  balance: number | undefined;
  currency: string;
  bankName: string;
}

/** Options injected into AccountImporter for all account-processing operations. */
export interface IAccountImporterOpts {
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
  constructor(private readonly opts: IAccountImporterOpts) {}

  /**
   * Iterates all accounts in a scrape result and processes each one.
   * @param bankName - The bank whose accounts are being processed.
   * @param bankConfig - The bank's configuration for date filtering and targets.
   * @param scrapeResult - The full scraper result containing all account data.
   * @returns Aggregated totals of imported and skipped transactions.
   */
  public async processAllAccounts(
    bankName: string, bankConfig: IBankConfig, scrapeResult: IScraperScrapingResult
  ): Promise<{ imported: number; skipped: number }> {
    const accounts = scrapeResult.accounts ?? [];
    return this.processAccountsSequentially({
      bankName, bankConfig, accounts, index: 0, imported: 0, skipped: 0,
    });
  }

  /**
   * Recursively processes accounts from the array starting at the given index.
   * @param ctx - Context with bank name, config, accounts array, and running totals.
   * @param ctx.bankName - The bank name for context.
   * @param ctx.bankConfig - The bank configuration.
   * @param ctx.accounts - Array of scraped accounts to process.
   * @param ctx.index - Zero-based index of the next account to process.
   * @param ctx.imported - Running total of imported transactions.
   * @param ctx.skipped - Running total of skipped transactions.
   * @returns Aggregated totals of imported and skipped transactions.
   */
  private async processAccountsSequentially(ctx: {
    bankName: string; bankConfig: IBankConfig;
    accounts: { accountNumber: string; balance?: number; txns: IBankTransaction[] }[];
    index: number; imported: number; skipped: number;
  }): Promise<{ imported: number; skipped: number }> {
    let imported = ctx.imported;
    let skipped = ctx.skipped;
    for (let i = ctx.index; i < ctx.accounts.length; i++) {
      if (this.opts.shutdownHandler.isShuttingDown()) {
        getLogger().warn('  ⚠️  Shutdown requested, stopping import...');
        return { imported, skipped };
      }
      const counts = await this.processSingleAccount(
        ctx.bankName, ctx.bankConfig, ctx.accounts[i]
      );
      imported += counts.imported;
      skipped += counts.skipped;
    }
    return { imported, skipped };
  }

  /**
   * Processes a single scraped account within the loop context.
   * @param bankName - The bank name for context.
   * @param bankConfig - The bank configuration.
   * @param account - Raw account data from the scraper.
   * @param account.accountNumber - The bank account number.
   * @param account.balance - Optional scraped balance in currency units.
   * @param account.txns - Transactions found by the scraper.
   * @returns Counts of imported and skipped transactions.
   */
  private async processSingleAccount(
    bankName: string, bankConfig: IBankConfig,
    account: { accountNumber: string; balance?: number; txns: IBankTransaction[] }
  ): Promise<{ imported: number; skipped: number }> {
    const firstTxn = account.txns[0] as unknown as Record<string, string> | undefined;
    const currency = firstTxn?.originalCurrency || 'ILS';
    return this.processOneAccount({ bankName, bankConfig, currency }, account);
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
    bankCtx: { bankName: string; bankConfig: IBankConfig; currency: string },
    account: { accountNumber: string; balance?: number; txns: IBankTransaction[] }
  ): Promise<{ imported: number; skipped: number }> {
    const target = AccountImporter.findTargetForAccount(bankCtx.bankConfig, account.accountNumber);
    const txns = filterTransactionsByDate(account.txns, bankCtx.bankConfig);
    AccountImporter.logAccountInfo({
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
    bankCtx: { bankName: string; bankConfig: IBankConfig; currency: string },
    account: { accountNumber: string; balance?: number; txns: IBankTransaction[] }
  ): Promise<{ imported: number; skipped: number }> {
    const { bankName, bankConfig, currency } = bankCtx;
    const target = AccountImporter.findTargetForAccount(bankConfig, account.accountNumber);
    if (!target) {
      getLogger().warn('     ⚠️  No target configured for this account, skipping');
      return { imported: 0, skipped: 0 };
    }
    if (this.opts.isDryRun) return this.collectDryRunAccount(bankName, account, currency);
    return this.importLiveAccount(target, account, { bankName, currency });
  }

  /**
   * Imports a live account: validates the Actual account, imports, and reconciles.
   * @param target - The IBankTarget with account ID and reconcile flag.
   * @param account - Raw account data from the scraper.
   * @param account.accountNumber - The bank account number.
   * @param account.balance - Optional scraped balance in currency units.
   * @param account.txns - Transactions to import.
   * @param bankCtx - Bank name and currency context.
   * @param bankCtx.bankName - The bank name for metrics and logging.
   * @param bankCtx.currency - Currency code for the account.
   * @returns Counts of imported and skipped transactions.
   */
  private async importLiveAccount(
    target: IBankTarget,
    account: { accountNumber: string; balance?: number; txns: IBankTransaction[] },
    bankCtx: { bankName: string; currency: string }
  ): Promise<{ imported: number; skipped: number }> {
    const accountResult = await this.opts.transactionService.getOrCreateAccount(
      target.actualAccountId, bankCtx.bankName, account.accountNumber
    );
    if (isFail(accountResult)) {
      getLogger().error(`     ❌ Account error: ${accountResult.message}`);
      return { imported: 0, skipped: 0 };
    }
    const result = await this.importAndReconcile(target, account, bankCtx);
    return { imported: result.imported, skipped: result.skipped };
  }

  /**
   * Imports transactions and then reconciles the account balance if configured.
   * @param target - The IBankTarget with account ID and reconcile flag.
   * @param account - Account data from the scraper.
   * @param account.accountNumber - The bank account number.
   * @param account.balance - Optional scraped balance in currency units.
   * @param account.txns - Transactions to import.
   * @param bankCtx - Bank name and currency context.
   * @param bankCtx.bankName - The bank name for metrics.
   * @param bankCtx.currency - Currency code for reconciliation.
   * @returns IImportResult with new/skipped counts, or null if no transactions.
   */
  private async importAndReconcile(
    target: IBankTarget,
    account: { accountNumber: string; balance?: number; txns: IBankTransaction[] },
    bankCtx: { bankName: string; currency: string }
  ): Promise<IImportResult> {
    const ctx: IImportTxnCtx = {
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
   * @param txns - The IBankTransaction array to import.
   * @returns IImportResult with new/skipped counts, or null if the array is empty.
   */
  private async importAndRecordTransactions(
    ctx: IImportTxnCtx, txns: IBankTransaction[]
  ): Promise<IImportResult> {
    const emptyResult: IImportResult = {
      imported: 0, skipped: 0, newTransactions: [], existingTransactions: [],
    };
    if (txns.length === 0) return emptyResult;
    const procedureResult = await this.executeImport(ctx, txns);
    if (isFail(procedureResult)) return emptyResult;
    return this.recordImportResult(ctx, procedureResult.data);
  }

  /**
   * Calls the transaction service to import transactions.
   * @param ctx - Context with bank name, account number, account ID, balance, and currency.
   * @param txns - The IBankTransaction array to import.
   * @returns Procedure with the import result.
   */
  private async executeImport(
    ctx: IImportTxnCtx, txns: IBankTransaction[]
  ): Promise<Procedure<IImportResult>> {
    const opts: IImportTransactionsOpts = {
      bankName: ctx.bankName, accountNumber: ctx.accountNumber,
      actualAccountId: ctx.actualAccountId, transactions: txns,
    };
    const procedureResult = await this.opts.transactionService.importTransactions(opts);
    if (isFail(procedureResult)) {
      getLogger().error(`     ❌ Import error: ${procedureResult.message}`);
    }
    return procedureResult;
  }

  /**
   * Records account transactions in the metrics service and returns the import result.
   * @param ctx - Context with bank name, account details, and currency.
   * @param result - The successful IImportResult to record.
   * @returns The same IImportResult passed in.
   */
  private recordImportResult(ctx: IImportTxnCtx, result: IImportResult): IImportResult {
    this.opts.metrics.recordAccountTransactions(ctx.bankName, {
      accountNumber: ctx.accountNumber, accountName: ctx.accountName,
      balance: ctx.balance, currency: ctx.currency,
      newTransactions: result.newTransactions, existingTransactions: result.existingTransactions,
    });
    return result;
  }

  /**
   * Runs reconciliation when the target's reconcile flag is true and balance is known.
   * @param target - The IBankTarget whose reconcile flag and account ID are used.
   * @param ctx - Context with the actual account ID, balance, currency, and bank name.
   */
  private async reconcileIfConfigured(target: IBankTarget, ctx: IReconcileCtx): Promise<void> {
    if (!target.reconcile || ctx.balance === undefined) return;
    getLogger().info('     🔄 Reconciling account balance...');
    const result = await this.opts.reconciliationService.reconcile(
      ctx.actualAccountId, ctx.balance, ctx.currency
    );
    if (isFail(result)) {
      getLogger().error(`     ❌ Reconciliation error: ${result.message}`);
      return;
    }
    this.opts.metrics.recordReconciliation(ctx.bankName, result.data.status, result.data.diff);
    const reconciliationMessage = RECONCILIATION_MESSAGES[result.data.status](result.data.diff);
    getLogger().info(reconciliationMessage);
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
    account: { accountNumber: string; balance?: number; txns: IBankTransaction[] },
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
   * Finds the IBankTarget configured for a given account number.
   * @param bankConfig - The IBankConfig whose targets list to search.
   * @param accountNumber - The account number to match.
   * @returns The matching IBankTarget, or undefined if none covers this account.
   */
  private static findTargetForAccount(
    bankConfig: IBankConfig, accountNumber: string
  ): IBankTarget | undefined {
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
  private static logAccountInfo(info: {
    accountNumber: string; accountName?: string;
    balance: number | undefined; currency: string; txnCount: number;
  }): void {
    const label = info.accountName
      ? `${info.accountName} (${info.accountNumber})` : info.accountNumber;
    getLogger().info(`\n  💳 Processing account: ${label}`);
    const bal = info.balance === undefined ? 'N/A' : `${String(info.balance)} ${info.currency}`;
    getLogger().info(`     Balance: ${bal}`);
    getLogger().info(`     Transactions: ${String(info.txnCount)}`);
  }
}
