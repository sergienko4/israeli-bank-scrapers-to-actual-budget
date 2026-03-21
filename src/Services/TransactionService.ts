/**
 * TransactionService - Handles transaction import into Actual Budget
 * Follows Single Responsibility Principle: Only handles transaction import logic
 */

import type api from '@actual-app/api';

import { getLogger } from '../Logger/Index.js';
import type {
  IActualAccount, IBankTransaction, IResolvedCategory,
  ITransactionRecord, Procedure} from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import { extractQueryData,formatDate, toCents } from '../Utils/Index.js';
import type { ICategoryResolver } from './ICategoryResolver.js';

export interface IImportResult {
  imported: number;
  skipped: number;
  newTransactions: ITransactionRecord[];
  existingTransactions: ITransactionRecord[];
}

export interface IImportTransactionsOpts {
  bankName: string;
  accountNumber: string;
  actualAccountId: string;
  transactions: IBankTransaction[];
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

/** Handles importing bank transactions into Actual Budget. */
export class TransactionService {
  private readonly _api: typeof api;
  private readonly _categoryResolver?: ICategoryResolver;

  /**
   * Creates a TransactionService with the given Actual API and optional category resolver.
   * @param actualApi - The Actual Budget API module for all database operations.
   * @param categoryResolver - Optional resolver to auto-assign categories by description.
   */
  constructor(actualApi: typeof api, categoryResolver?: ICategoryResolver) {
    this._api = actualApi;
    this._categoryResolver = categoryResolver;
  }

  /**
   * Imports transactions for an account into Actual Budget.
   * @param opts - Options including bank name, account number, account ID, and transactions.
   * @returns Procedure wrapping IImportResult with counts of new and skipped transactions.
   */
  public async importTransactions(
    opts: IImportTransactionsOpts
  ): Promise<Procedure<IImportResult>> {
    getLogger().info(
      `     📥 Importing ${String(opts.transactions.length)} transactions...`
    );
    const { newTransactions, existingTransactions } = await this.processTransactionBatch(opts);
    getLogger().info(
      `     ✅ New: ${String(newTransactions.length)}, ` +
        `Existing: ${String(existingTransactions.length)}`
    );
    return succeed({
      imported: newTransactions.length, skipped: existingTransactions.length,
      newTransactions, existingTransactions
    });
  }

  /**
   * Returns an existing Actual account or creates a new one with the given UUID.
   * @param accountId - UUID to look up or create.
   * @param bankName - Bank name used when creating the account label.
   * @param accountNumber - Account number used when creating the account label.
   * @returns Procedure wrapping the found or newly created IActualAccount, or failure.
   */
  public async getOrCreateAccount(
    accountId: string, bankName: string, accountNumber: string
  ): Promise<Procedure<IActualAccount>> {
    const accounts = await this._api.getAccounts() as IActualAccount[];
    const existing = accounts.find((a) => a.id === accountId);

    if (existing) return succeed(existing);

    getLogger().info(`     ➕ Creating new account: ${accountId}`);
    // Actual accepts id to set specific UUID, though not in official type
    const created = await this._api.createAccount({
      id: accountId,
      name: `${bankName} - ${accountNumber}`,
      offbudget: false,
      closed: false
    } as Omit<IActualAccount, 'id'>);

    if (!created || typeof created === 'string') {
      return fail('account not found', { status: 'account-not-found' });
    }

    return succeed(created as IActualAccount);
  }

  /**
   * Iterates the transaction list and separates new from existing.
   * @param opts - Import options containing the transactions to process.
   * @returns Object with arrays of new and existing ITransactionRecord.
   */
  private async processTransactionBatch(
    opts: IImportTransactionsOpts
  ): Promise<{
    newTransactions: ITransactionRecord[];
    existingTransactions: ITransactionRecord[];
  }> {
    const existingIds = await this.getExistingImportedIds(opts.actualAccountId);
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
   * Recursively processes a transaction at the given index.
   * @param ctx - Batch context with transactions and accumulators.
   * @param ctx.txns - Full transaction array.
   * @param ctx.accountKey - Bank-account key for imported_id.
   * @param ctx.actualAccountId - Actual Budget account UUID.
   * @param ctx.existingIds - Set of already-imported IDs.
   * @param ctx.newTxns - Accumulator for new transactions.
   * @param ctx.existingTxns - Accumulator for existing transactions.
   * @param idx - Current index to process.
   * @returns Procedure indicating all transactions were processed.
   */
  private async processTxnAt(
    ctx: IBatchContext, idx: number
  ): Promise<Procedure<{ status: string }>> {
    if (idx >= ctx.txns.length) return succeed({ status: 'done' });
    const parsed = TransactionService.parseTransaction(ctx.txns[idx]);
    const importedId = TransactionService.buildImportedId(
      ctx.accountKey, ctx.txns[idx], parsed
    );
    const target = ctx.existingIds.has(importedId)
      ? ctx.existingTxns : ctx.newTxns;
    await this.importSingleTransaction({
      actualAccountId: ctx.actualAccountId, txn: ctx.txns[idx],
      parsed, importedId, target,
      existingTransactions: ctx.existingTxns,
    });
    return this.processTxnAt(ctx, idx + 1);
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
    ctx: ISingleTxnContext
  ): Promise<Procedure<{ status: string }>> {
    const resolved = this.resolveCategory(ctx.parsed.description);
    const payload = {
      account: ctx.actualAccountId, date: ctx.parsed.date, amount: ctx.parsed.amount,
      payee_name: resolved?.payeeName ?? ctx.parsed.description,
      imported_payee: resolved?.importedPayee, imported_id: ctx.importedId,
      category: resolved?.categoryId, notes: ctx.txn.memo ?? ctx.parsed.description,
      cleared: true,
    };
    try {
      await this._api.importTransactions(ctx.actualAccountId, [payload]);
      ctx.target.push(ctx.parsed);
      return succeed({ status: 'imported' });
    } catch (error: unknown) {
      return TransactionService.handleImportError(error, ctx);
    }
  }

  /**
   * Handles errors from importing a single transaction.
   * @param error - The caught error.
   * @param ctx - Context with transaction data and target arrays.
   * @returns Procedure indicating the error handling result.
   */
  private static handleImportError(
    error: unknown,
    ctx: ISingleTxnContext
  ): Procedure<{ status: string }> {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('already exists')) {
      ctx.existingTransactions.push(ctx.parsed);
      return succeed({ status: 'duplicate' });
    }
    getLogger().error(`     ❌ Error importing transaction: ${msg}`);
    return succeed({ status: 'error' });
  }

  /**
   * Builds a stable unique identifier for a transaction to detect duplicates.
   * @param accountKey - Combined bank-account string used as a namespace.
   * @param txn - The raw IBankTransaction from the scraper.
   * @param parsed - The parsed ITransactionRecord with formatted date.
   * @returns A string imported_id for use with Actual's importTransactions API.
   */
  private static buildImportedId(
    accountKey: string, txn: IBankTransaction, parsed: ITransactionRecord
  ): string {
    const fallback =
      `${parsed.date}-${String(txn.chargedAmount ?? txn.originalAmount)}`;
    return `${accountKey}-${String(txn.identifier || fallback)}`;
  }

  /**
   * Queries Actual Budget for all imported_id values already in the account.
   * @param accountId - UUID of the Actual account to query.
   * @returns Set of imported_id strings for fast duplicate detection.
   */
  private async getExistingImportedIds(accountId: string): Promise<Set<string>> {
    const query = this._api.q('transactions')
      .filter({ account: accountId, imported_id: { $ne: null } })
      .select(['imported_id']);
    const result = await this._api.aqlQuery(query);
    const rows = extractQueryData<{ imported_id: string }[]>(result, []);
    return new Set(rows.map((t) => t.imported_id));
  }

  /**
   * Converts a raw IBankTransaction from the scraper into a ITransactionRecord.
   * @param txn - The raw IBankTransaction to convert.
   * @returns A ITransactionRecord with formatted date and amount in cents.
   */
  private static parseTransaction(txn: IBankTransaction): ITransactionRecord {
    return {
      date: formatDate(txn.date),
      description: txn.description ?? 'Unknown',
      amount: toCents(txn.chargedAmount ?? txn.originalAmount ?? 0)
    };
  }
}
