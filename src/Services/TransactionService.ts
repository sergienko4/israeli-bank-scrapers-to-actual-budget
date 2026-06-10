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
import { errorMessage } from '../Utils/Index.js';
import type { ICategoryResolver } from './ICategoryResolver.js';
import DedupQuery from './Transaction/DedupQuery.js';
import {
  buildImportedId, buildImportedIdLegacy, parseTransaction,
} from './Transaction/ImportedIdBuilder.js';

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
  private readonly _dedupQuery: DedupQuery;

  /**
   * Creates a TransactionService with the given Actual API and optional category resolver.
   * @param actualApi - The Actual Budget API module for all database operations.
   * @param categoryResolver - Optional resolver to auto-assign categories by description.
   */
  constructor(actualApi: typeof api, categoryResolver?: ICategoryResolver) {
    this._api = actualApi;
    this._categoryResolver = categoryResolver;
    this._dedupQuery = new DedupQuery(actualApi);
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
    try {
      const { newTransactions, existingTransactions } = await this.processTransactionBatch(opts);
      getLogger().info(
        `     ✅ New: ${String(newTransactions.length)}, ` +
          `Existing: ${String(existingTransactions.length)}`
      );
      return succeed({
        imported: newTransactions.length, skipped: existingTransactions.length,
        newTransactions, existingTransactions
      });
    } catch (error: unknown) {
      return fail(`Transaction import failed: ${errorMessage(error)}`, { error: error as Error });
    }
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
    try {
      const accounts = await this._api.getAccounts() as IActualAccount[];
      const accountLabel = `${bankName} - ${accountNumber}`;
      const existing = TransactionService.findExistingAccount(accounts, accountId, accountLabel);
      if (existing) return succeed(existing);

      getLogger().info(`     ➕ Creating new account: ${accountId}`);
      return await this.createNewAccount(accountId, accountLabel);
    } catch (error: unknown) {
      return fail(`Account lookup failed: ${errorMessage(error)}`, { error: error as Error });
    }
  }

  /**
   * Finds an existing account by ID or by name (fallback).
   * Actual Budget may assign its own UUID, ignoring the configured ID.
   * The name fallback handles this by matching the deterministic label.
   * @param accounts - All accounts from Actual Budget.
   * @param accountId - Configured account UUID to match first.
   * @param accountLabel - Deterministic label ("bankName - accountNumber").
   * @returns The matching account, or undefined if not found.
   */
  private static findExistingAccount(
    accounts: IActualAccount[], accountId: string, accountLabel: string
  ): IActualAccount | undefined {
    const byId = accounts.find((a) => a.id === accountId);
    if (byId) return byId;
    const byName = accounts.filter((a) => a.name === accountLabel);
    if (byName.length === 0) return byName[0]; // undefined — no name match
    if (byName.length > 1) {
      getLogger().warn(
        `     ⚠️ ${String(byName.length)} accounts named "${accountLabel}" — using ${byName[0].id}`
      );
    }
    getLogger().info(`     Found existing account by name: ${accountLabel} (${byName[0].id})`);
    return byName[0];
  }

  /**
   * Creates a new Actual Budget account and returns it as a Procedure.
   * @param accountId - UUID for the new account.
   * @param accountLabel - Display name for the new account.
   * @returns Procedure wrapping the created IActualAccount.
   */
  private async createNewAccount(
    accountId: string, accountLabel: string
  ): Promise<Procedure<IActualAccount>> {
    try {
      const created = await this._api.createAccount({
        id: accountId, name: accountLabel, offbudget: false, closed: false,
      } as Omit<IActualAccount, 'id'>);
      if (!created) return fail('account creation returned empty', { status: 'account-not-found' });
      if (typeof created === 'string') return succeed({ id: created, name: accountLabel });
      return succeed(created as IActualAccount);
    } catch (error: unknown) {
      return fail(`Account creation failed: ${errorMessage(error)}`, { error: error as Error });
    }
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
   * Iteratively processes all transactions in the batch.
   * @param ctx - Batch context with transactions and accumulators.
   * @param ctx.txns - Full transaction array.
   * @param ctx.accountKey - Bank-account key for imported_id.
   * @param ctx.actualAccountId - Actual Budget account UUID.
   * @param ctx.existingIds - Set of already-imported IDs.
   * @param ctx.newTxns - Accumulator for new transactions.
   * @param ctx.existingTxns - Accumulator for existing transactions.
   * @param startIdx - Zero-based index to start processing from.
   * @returns Procedure indicating all transactions were processed.
   */
  private async processTxnAt(
    ctx: IBatchContext, startIdx: number
  ): Promise<Procedure<{ status: string }>> {
    for (let idx = startIdx; idx < ctx.txns.length; idx++) {
      await this.processSingleAt(ctx, idx);
    }
    return succeed({ status: 'done' });
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
    ctx: ISingleTxnContext
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
    return fail(`Import error: ${msg}`);
  }
}
