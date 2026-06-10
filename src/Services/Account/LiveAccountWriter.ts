/**
 * LiveAccountWriter — performs the actual write of one account's data into
 * Actual Budget when the run is not a dry run.
 *
 * Owns the five-method flow: resolve the Actual account (`importLiveAccount`),
 * import + reconcile (`importAndReconcile`), short-circuit empty (`importAndRecordTransactions`),
 * delegate the API call (`executeImport`), and record the resulting metrics
 * (`recordImportResult`). AccountImporter delegates here so the orchestrator
 * stays a thin loop coordinator.
 */
import { getLogger } from '../../Logger/Index.js';
import type { IBankTarget, IBankTransaction, Procedure } from '../../Types/Index.js';
import { isFail } from '../../Types/Index.js';
import type { MetricsService } from '../MetricsService.js';
import type {
  IImportResult, IImportTransactionsOpts,
  TransactionService,
} from '../TransactionService.js';
import type { AccountReconciler } from './AccountReconciler.js';

/** Context for importing one account's transactions. */
export interface IImportTxnCtx {
  /** Bank name for metrics tagging. */
  bankName: string;
  /** The bank account number. */
  accountNumber: string;
  /** Optional account display name. */
  accountName?: string;
  /** Actual Budget account ID. */
  actualAccountId: string;
  /** Scraped balance in currency units, or undefined when unknown. */
  balance: number | undefined;
  /** Currency code (e.g. 'ILS'). */
  currency: string;
}

/** Services and helpers injected into LiveAccountWriter. */
export interface ILiveAccountWriterOpts {
  /** Transaction service for importing and querying Actual Budget. */
  transactionService: TransactionService;
  /** Metrics service for recording per-account stats. */
  metrics: MetricsService;
  /** Reconciler that runs the balance-adjustment flow after importing. */
  reconciler: AccountReconciler;
}

/** Snapshot of one scraped account passed through the write pipeline. */
export interface IAccountSnapshot {
  /** The bank account number. */
  accountNumber: string;
  /** Scraped balance in currency units, when known. */
  balance?: number;
  /** Transactions to import. */
  txns: IBankTransaction[];
}

/** Bank-level context for one write. */
export interface IWriteBankCtx {
  /** Bank name for metrics and logging. */
  bankName: string;
  /** Currency code for the account. */
  currency: string;
}

/** Imports one live account's transactions into Actual Budget and reconciles its balance. */
export class LiveAccountWriter {
  /**
   * Creates a LiveAccountWriter with the given service dependencies.
   * @param opts - All services and helpers needed for the write pipeline.
   */
  constructor(private readonly opts: ILiveAccountWriterOpts) {}

  /**
   * Validates the Actual Budget account, imports transactions, and reconciles balance.
   * @param target - The IBankTarget with account ID and reconcile flag.
   * @param account - Raw account data from the scraper.
   * @param bankCtx - Bank name and currency context.
   * @returns Counts of imported and skipped transactions.
   */
  public async importLiveAccount(
    target: IBankTarget, account: IAccountSnapshot, bankCtx: IWriteBankCtx,
  ): Promise<{ imported: number; skipped: number }> {
    const accountResult = await this.opts.transactionService.getOrCreateAccount(
      target.actualAccountId, bankCtx.bankName, account.accountNumber,
    );
    if (isFail(accountResult)) {
      getLogger().error(`     ❌ Account error: ${accountResult.message}`);
      return { imported: 0, skipped: 0 };
    }
    const resolvedTarget = { ...target, actualAccountId: accountResult.data.id };
    const result = await this.importAndReconcile(resolvedTarget, account, bankCtx);
    return { imported: result.imported, skipped: result.skipped };
  }

  /**
   * Imports transactions and then reconciles the account balance if configured.
   * @param target - The IBankTarget with account ID and reconcile flag.
   * @param account - Account data from the scraper.
   * @param bankCtx - Bank name and currency context.
   * @returns IImportResult with new/skipped counts.
   */
  private async importAndReconcile(
    target: IBankTarget, account: IAccountSnapshot, bankCtx: IWriteBankCtx,
  ): Promise<IImportResult> {
    const ctx: IImportTxnCtx = {
      bankName: bankCtx.bankName, accountNumber: account.accountNumber,
      accountName: target.accountName, actualAccountId: target.actualAccountId,
      balance: account.balance, currency: bankCtx.currency,
    };
    const result = await this.importAndRecordTransactions(ctx, account.txns);
    await this.opts.reconciler.reconcileIfConfigured(target, {
      actualAccountId: target.actualAccountId,
      balance: account.balance, currency: bankCtx.currency, bankName: bankCtx.bankName,
    });
    return result;
  }

  /**
   * Imports transactions into Actual Budget and records the result in MetricsService.
   * @param ctx - Context with bank name, account number, account ID, balance, and currency.
   * @param txns - The IBankTransaction array to import.
   * @returns IImportResult with new/skipped counts, or empty when no transactions.
   */
  private async importAndRecordTransactions(
    ctx: IImportTxnCtx, txns: IBankTransaction[],
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
    ctx: IImportTxnCtx, txns: IBankTransaction[],
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
   * Records account transactions in MetricsService and returns the import result.
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
}
