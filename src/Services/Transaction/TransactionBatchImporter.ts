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
 *
 * One deliberate departure since: identical charges arriving in the same
 * batch are now separated by a per-batch occurrence index, so a genuine
 * double charge no longer collapses into a single ledger row. Single
 * transactions — the overwhelming majority — hash exactly as before.
 */

import type api from '@actual-app/api';

import { getLogger } from '../../Logger/Index.js';
import type {
  IBankTransaction, IResolvedCategory, ITransactionRecord, Procedure,
} from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import { errorMessage } from '../../Utils/Index.js';
import type { ICategoryResolver } from '../ICategoryResolver.js';
import type DedupQuery from './DedupQuery.js';
import {
  buildContentKey, buildImportedIdAt, buildImportedIdLegacy, parseTransaction,
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

/**
 * Abstraction for the per-account transaction batch-import loop.
 *
 * TransactionService depends on this seam rather than the concrete
 * {@link TransactionBatchImporter} so the import-orchestration logic can be
 * exercised by a fake in tests without reaching Actual Budget.
 */
export interface ITransactionBatchImporter {
  /**
   * Processes a transaction batch, separating new from already-imported.
   * @param opts - Batch options containing bank name, account info and transactions.
   * @returns Outcome with arrays of new and existing ITransactionRecord.
   */
  processBatch(opts: IBatchOpts): Promise<IBatchOutcome>;
}

interface IBatchContext {
  txns: IBankTransaction[];
  accountKey: string;
  actualAccountId: string;
  existingIds: Set<string>;
  newTxns: ITransactionRecord[];
  existingTxns: ITransactionRecord[];
  /** Content key -> how many identical charges have been seen in this batch. */
  occurrences: Map<string, number>;
  /** Legacy ids already claimed by an earlier transaction in this batch. */
  claimedLegacyIds: Set<string>;
}

interface ISingleTxnContext {
  actualAccountId: string;
  txn: IBankTransaction;
  parsed: ITransactionRecord;
  importedId: string;
  target: ITransactionRecord[];
  existingTransactions: ITransactionRecord[];
}

type SingleImportResult = Procedure<{ status: string }>;

interface IImportPayload {
  account: string;
  date: string;
  amount: number;
  payee_name: string;
  imported_payee: string;
  imported_id: string;
  category: string | undefined;
  notes: string;
  cleared: boolean;
}

/**
 * Imports a batch of bank transactions into Actual Budget with dedup
 * against both new-hash and legacy imported_id formats.
 */
export default class TransactionBatchImporter implements ITransactionBatchImporter {
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
    const batchCtx = TransactionBatchImporter.buildBatchContext(opts, existingIds);
    await this.processTxnAt(batchCtx, 0);
    return {
      newTransactions: batchCtx.newTxns,
      existingTransactions: batchCtx.existingTxns,
    };
  }

  /**
   * Builds the mutable batch context (accumulator arrays + dedup set) the
   * per-transaction loop fills. The returned newTxns/existingTxns arrays
   * are the same references {@link processBatch} returns.
   *
   * The occurrence counter starts empty per batch so identical charges are
   * numbered from 0 on every run, keeping repeat scrapes idempotent.
   * @param opts - Batch options with bank name, account info and transactions.
   * @param existingIds - Pre-fetched imported_id set used for dedup.
   * @returns Fresh batch context seeded with empty accumulators.
   */
  private static buildBatchContext(opts: IBatchOpts, existingIds: Set<string>): IBatchContext {
    return {
      txns: opts.transactions,
      accountKey: `${opts.bankName}-${opts.accountNumber}`,
      actualAccountId: opts.actualAccountId,
      existingIds,
      newTxns: [], existingTxns: [],
      occurrences: new Map<string, number>(), claimedLegacyIds: new Set<string>(),
    };
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
    const { importedId, target } = TransactionBatchImporter.classify(ctx, txn, parsed);
    await this.importSingleTransaction({
      actualAccountId: ctx.actualAccountId, txn,
      parsed, importedId, target,
      existingTransactions: ctx.existingTxns,
    });
  }

  /**
   * Returns how many identical charges this batch has already seen, then
   * records this one.
   *
   * The counter is per batch, not per ledger: it exists to separate copies
   * that arrive together, while occurrence 0 keeps hashing the bare content
   * key so repeat runs still match what was written before.
   * @param ctx - Batch context holding the per-batch occurrence counter.
   * @param contentKey - Key from buildContentKey identifying the charge.
   * @returns Zero-based index of this charge among its identical siblings.
   */
  private static takeOccurrence(ctx: IBatchContext, contentKey: string): number {
    const seen = ctx.occurrences.get(contentKey) ?? 0;
    ctx.occurrences.set(contentKey, seen + 1);
    return seen;
  }

  /**
   * Claims the pre-2026-05 row matching this transaction, if one is free.
   *
   * Legacy ids are keyed on `txn.identifier`, so identical charges usually
   * hold DISTINCT legacy ids and must each be able to match. A given legacy
   * id can still only stand for one ledger row, so it is claimed at most once
   * per batch: when identifiers are absent both copies collapse onto the same
   * legacy id, and only the first may consume it — otherwise the second copy
   * would be re-suppressed, which is the very bug the occurrence index fixes.
   * @param ctx - Batch context holding the id set and the claim register.
   * @param txn - Raw bank transaction being classified.
   * @param parsed - Parsed transaction record derived from txn.
   * @returns The claimed legacy id, or '' when no free legacy row matched.
   */
  private static claimLegacyRow(
    ctx: IBatchContext, txn: IBankTransaction, parsed: ITransactionRecord,
  ): string {
    const legacyId = buildImportedIdLegacy(ctx.accountKey, txn, parsed);
    if (!ctx.existingIds.has(legacyId) || ctx.claimedLegacyIds.has(legacyId)) return '';
    ctx.claimedLegacyIds.add(legacyId);
    return legacyId;
  }

  /**
   * Picks the id and accumulator once both candidate ids are known.
   * @param ctx - Batch context supplying the accumulator arrays.
   * @param hashId - Occurrence-aware content hash for this transaction.
   * @param legacyId - Claimed legacy id, or '' when none was free.
   * @returns The chosen imported_id and the target accumulator array.
   */
  private static pickTarget(
    ctx: IBatchContext, hashId: string, legacyId: string,
  ): { importedId: string; target: ITransactionRecord[] } {
    if (legacyId === '') return { importedId: hashId, target: ctx.newTxns };
    return { importedId: legacyId, target: ctx.existingTxns };
  }

  /**
   * Classifies a transaction as new or already-imported via dual-format
   * dedup (new hash + legacy imported_id), returning the imported_id to
   * persist plus the accumulator array it belongs in.
   *
   * A transaction matched only by the legacy format is re-submitted under
   * that same legacy id, never the freshly derived hash: the ledger row is
   * stored under the legacy id, so sending the hash would present Actual
   * with an id it has never seen and duplicate the row it was meant to match.
   * @param ctx - Batch context with the dedup set and accumulator arrays.
   * @param txn - Raw bank transaction being classified.
   * @param parsed - Parsed transaction record derived from txn.
   * @returns The chosen imported_id and the target accumulator array.
   */
  private static classify(
    ctx: IBatchContext, txn: IBankTransaction, parsed: ITransactionRecord,
  ): { importedId: string; target: ITransactionRecord[] } {
    const contentKey = buildContentKey(ctx.accountKey, txn, parsed);
    const occurrence = TransactionBatchImporter.takeOccurrence(ctx, contentKey);
    const hashId = buildImportedIdAt(contentKey, occurrence);
    if (ctx.existingIds.has(hashId)) return { importedId: hashId, target: ctx.existingTxns };
    const legacyId = TransactionBatchImporter.claimLegacyRow(ctx, txn, parsed);
    return TransactionBatchImporter.pickTarget(ctx, hashId, legacyId);
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
  private async importSingleTransaction(ctx: ISingleTxnContext): Promise<SingleImportResult> {
    const payload = this.buildImportPayload(ctx);
    try {
      await this._api.importTransactions(ctx.actualAccountId, [payload]);
      ctx.target.push(ctx.parsed);
      return succeed({ status: 'imported' });
    } catch (error: unknown) {
      return TransactionBatchImporter.handleImportError(error, ctx);
    }
  }

  /**
   * Builds the Actual Budget import payload for one transaction, applying
   * category-resolver output (payee_name / imported_payee / category) and
   * falling back to the transaction description.
   * @param ctx - Single-transaction context with parsed data and imported_id.
   * @returns Import payload object passed to actualApi.importTransactions.
   */
  private buildImportPayload(ctx: ISingleTxnContext): IImportPayload {
    const resolved = this.resolveCategory(ctx.parsed.description);
    return {
      account: ctx.actualAccountId, date: ctx.parsed.date, amount: ctx.parsed.amount,
      payee_name: resolved?.payeeName ?? ctx.parsed.description,
      imported_payee: resolved?.importedPayee ?? ctx.parsed.description,
      imported_id: ctx.importedId, category: resolved?.categoryId, cleared: true,
      notes: ctx.txn.memo ?? ctx.parsed.description,
    };
  }

  /**
   * Handles errors from importing a single transaction, treating duplicates as
   * existing rather than failure.
   * @param error - The caught error, normalized via {@link errorMessage}.
   * @param ctx - Context with transaction data and target arrays.
   * @returns Procedure indicating the error handling result.
   */
  private static handleImportError(error: unknown, ctx: ISingleTxnContext): SingleImportResult {
    const msg = errorMessage(error);
    if (msg.includes('already exists')) {
      ctx.existingTransactions.push(ctx.parsed);
      return succeed({ status: 'duplicate' });
    }
    getLogger().error(`     ❌ Error importing transaction: ${msg}`);
    return fail(`Import error: ${msg}`);
  }
}
