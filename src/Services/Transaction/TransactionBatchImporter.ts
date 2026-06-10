/**
 * TransactionBatchImporter - Drives the per-transaction import loop.
 *
 * Owns the dedup-aware batch loop plus the single-transaction import
 * call into Actual Budget. Extracted from TransactionService at PR #423/c4
 * so that TransactionService stays an orchestrator over collaborators
 * (DedupQuery, AccountResolver, this importer) rather than carrying the
 * import-loop body itself.
 *
 * Behaviour preserved byte-identical: dual-format dedup (new hash + legacy),
 * `already exists` -> existingTransactions classification, category resolver
 * delegation, payload shape into actualApi.importTransactions.
 */

import type api from '@actual-app/api';

import { getLogger } from '../../Logger/Index.js';
import type {
  IBankTransaction, IResolvedCategory, ITransactionRecord, Procedure,
} from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import type { ICategoryResolver } from '../ICategoryResolver.js';
import type DedupQuery from './DedupQuery.js';
import {
  buildImportedId, buildImportedIdLegacy, parseTransaction,
} from './ImportedIdBuilder.js';

export interface IBatchOpts {
  bankName: string;
  accountNumber: string;
  actualAccountId: string;
  transactions: IBankTransaction[];
}

export interface IBatchOutcome {
  newTransactions: ITransactionRecord[];
  existingTransactions: ITransactionRecord[];
}

interface IBatchContext {
  txns: IBankTransaction[];
  accountKey: string;
  actualAccountId: string;
  existingIds: Set<string>;
  newTxns: ITransactionRecord[];
  existingTxns: ITransactionRecord[];
}

interface ISingleTxnContext {
  actualAccountId: string;
  txn: IBankTransaction;
  parsed: ITransactionRecord;
  importedId: string;
  target: ITransactionRecord[];
  existingTransactions: ITransactionRecord[];
}

/**
 * Imports a batch of bank transactions into Actual Budget with dedup
 * against both new-hash and legacy imported_id formats.
 */
export default class TransactionBatchImporter {
  private readonly _api: typeof api;
  private readonly _dedupQuery: DedupQuery;
  private readonly _categoryResolver?: ICategoryResolver;

  /**
   * Creates a TransactionBatchImporter wired to the Actual API plus
   * shared dedup query and an optional category resolver.
   * @param actualApi - Actual Budget API module used for importTransactions calls.
   * @param dedupQuery - Pre-built DedupQuery instance for existing imported_id lookups.
   * @param categoryResolver - Optional resolver to auto-assign categories by description.
   */
  constructor(
    actualApi: typeof api,
    dedupQuery: DedupQuery,
    categoryResolver?: ICategoryResolver,
  ) {
    this._api = actualApi;
    this._dedupQuery = dedupQuery;
    this._categoryResolver = categoryResolver;
  }

  /**
   * Processes a transaction batch, separating new from already-imported.
   * @param opts - Batch options containing bank name, account info and transactions.
   * @returns Outcome with arrays of new and existing ITransactionRecord.
   */
  public async processBatch(opts: IBatchOpts): Promise<IBatchOutcome> {
    const existingIds = await this._dedupQuery.getExistingImportedIds(opts.actualAccountId);
    const newTransactions: ITransactionRecord[] = [];
    const existingTransactions: ITransactionRecord[] = [];
    const batchCtx: IBatchContext = {
      txns: opts.transactions,
      accountKey: `${opts.bankName}-${opts.accountNumber}`,
      actualAccountId: opts.actualAccountId,
      existingIds, newTxns: newTransactions,
      existingTxns: existingTransactions,
    };
    await this.processTxnAt(batchCtx, 0);
    return { newTransactions, existingTransactions };
  }

  /**
   * Iteratively processes all transactions in the batch starting at idx.
   * Implemented as tail-recursion (not a for-await loop) so the extracted
   * module does not require the no-await-in-loop exemption that the
   * TransactionService orchestrator file historically held.
   * @param ctx - Batch context with transactions and accumulators.
   * @param idx - Zero-based index of the transaction to process next.
   */
  private async processTxnAt(ctx: IBatchContext, idx: number): Promise<void> {
    if (idx >= ctx.txns.length) return;
    await this.processSingleAt(ctx, idx);
    await this.processTxnAt(ctx, idx + 1);
  }

  /**
   * Processes one transaction at index `idx`, applying dual-check dedup
   * against both the new (hash) and legacy imported_id formats.
   * @param ctx - Batch context with txns, account info, and accumulators.
   * @param idx - Zero-based index of the transaction to process.
   */
  private async processSingleAt(ctx: IBatchContext, idx: number): Promise<void> {
    const txn = ctx.txns[idx];
    const parsed = parseTransaction(txn);
    const importedId = buildImportedId(ctx.accountKey, txn, parsed);
    const legacyId = buildImportedIdLegacy(ctx.accountKey, txn, parsed);
    const isExisting = ctx.existingIds.has(importedId) || ctx.existingIds.has(legacyId);
    const target = isExisting ? ctx.existingTxns : ctx.newTxns;
    await this.importSingleTransaction({
      actualAccountId: ctx.actualAccountId, txn,
      parsed, importedId, target,
      existingTransactions: ctx.existingTxns,
    });
  }

  /**
   * Resolves the category for a transaction description.
   * @param description - The transaction description to resolve.
   * @returns Resolved category data, or undefined if no match.
   */
  private resolveCategory(description: string): IResolvedCategory | undefined {
    const result = this._categoryResolver?.resolve(description);
    return result?.success ? result.data : undefined;
  }

  /**
   * Imports a single transaction into Actual Budget.
   * @param ctx - Context with account ID, transaction data, and targets.
   * @returns Procedure indicating the import result.
   */
  private async importSingleTransaction(
    ctx: ISingleTxnContext,
  ): Promise<Procedure<{ status: string }>> {
    const resolved = this.resolveCategory(ctx.parsed.description);
    const payload = {
      account: ctx.actualAccountId, date: ctx.parsed.date, amount: ctx.parsed.amount,
      payee_name: resolved?.payeeName ?? ctx.parsed.description,
      imported_payee: resolved?.importedPayee ?? ctx.parsed.description,
      imported_id: ctx.importedId,
      category: resolved?.categoryId, notes: ctx.txn.memo ?? ctx.parsed.description,
      cleared: true,
    };
    try {
      await this._api.importTransactions(ctx.actualAccountId, [payload]);
      ctx.target.push(ctx.parsed);
      return succeed({ status: 'imported' });
    } catch (error) {
      return TransactionBatchImporter.handleImportError(error, ctx);
    }
  }

  /**
   * Handles errors from importing a single transaction, treating duplicates as
   * existing rather than failure.
   * @param error - The caught error.
   * @param ctx - Context with transaction data and target arrays.
   * @returns Procedure indicating the error handling result.
   */
  private static handleImportError(
    error: unknown,
    ctx: ISingleTxnContext,
  ): Procedure<{ status: string }> {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('already exists')) {
      ctx.existingTransactions.push(ctx.parsed);
      return succeed({ status: 'duplicate' });
    }
    getLogger().error(`     ❌ Error importing transaction: ${msg}`);
    return fail(`Import error: ${msg}`);
  }
}
