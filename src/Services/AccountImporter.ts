/**
 * Account import orchestration extracted from Index.ts to keep it under 300 lines.
 */
import { getLogger } from '../Logger/Index.js';
import type { IShutdownHandler } from '../Resilience/GracefulShutdown.js';
import { filterTransactionsByDate } from '../Scraper/BankScraper.js';
import type {
  IBankConfig, IBankTransaction, ICanonicalScrapeResult,
} from '../Types/Index.js';
import { isFail, isSuccess } from '../Types/Index.js';
import { AccountLogPresenter } from './Account/AccountLogPresenter.js';
import { toMutableAccount } from './Account/AccountMutator.js';
import { AccountReconciler } from './Account/AccountReconciler.js';
import findTargetForAccount from './Account/AccountTargetResolver.js';
import { LiveAccountWriter } from './Account/LiveAccountWriter.js';
import type { DryRunCollector } from './DryRunCollector.js';
import type { MetricsService } from './MetricsService.js';
import type { ReconciliationService } from './ReconciliationService.js';
import type { TransactionService } from './TransactionService.js';

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
  private readonly _reconciler: AccountReconciler;
  private readonly _writer: LiveAccountWriter;
  private readonly _presenter: AccountLogPresenter;

  /**
   * Creates an AccountImporter with the given service dependencies.
   * @param opts - All services needed for account processing.
   */
  constructor(private readonly opts: IAccountImporterOpts) {
    this._reconciler = new AccountReconciler({
      reconciliationService: opts.reconciliationService,
      metrics: opts.metrics,
    });
    this._writer = new LiveAccountWriter({
      transactionService: opts.transactionService,
      metrics: opts.metrics,
      reconciler: this._reconciler,
    });
    this._presenter = new AccountLogPresenter({ dryRunCollector: opts.dryRunCollector });
  }

  /**
   * Iterates all accounts in a canonical scrape result and processes each.
   * @param bankName - The bank whose accounts are being processed.
   * @param bankConfig - The bank's configuration for date filtering and targets.
   * @param canonicalResult - Canonical scrape result produced by Phase-2 mapper.
   * @returns Aggregated totals of imported and skipped transactions.
   */
  public async processAllAccounts(
    bankName: string, bankConfig: IBankConfig, canonicalResult: ICanonicalScrapeResult
  ): Promise<{ imported: number; skipped: number }> {
    const accounts = canonicalResult.accounts.map(toMutableAccount);
    return await this.processAccountsSequentially({
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
    return await this.processOneAccount({ bankName, bankConfig, currency }, account);
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
    const targetResult = findTargetForAccount(bankCtx.bankConfig, account.accountNumber);
    const accountName = isSuccess(targetResult) ? targetResult.data.accountName : undefined;
    const txns = filterTransactionsByDate(account.txns, bankCtx.bankConfig);
    AccountLogPresenter.logAccountInfo({
      accountNumber: account.accountNumber, accountName,
      balance: account.balance, currency: bankCtx.currency, txnCount: txns.length,
    });
    return await this.processAccount(bankCtx, { ...account, txns });
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
    const targetResult = findTargetForAccount(bankConfig, account.accountNumber);
    if (isFail(targetResult)) {
      getLogger().warn('     ⚠️  No target configured for this account, skipping');
      return { imported: 0, skipped: 0 };
    }
    if (this.opts.isDryRun) {
      return this._presenter.collectDryRunAccount(bankName, account, currency);
    }
    return await this._writer.importLiveAccount(targetResult.data, account, { bankName, currency });
  }
}
