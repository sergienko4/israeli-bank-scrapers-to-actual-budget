/**
 * TransactionService - Handles transaction import into Actual Budget
 * Follows Single Responsibility Principle: Only handles transaction import logic
 */

import type api from '@actual-app/api';
import type { BankTransaction, TransactionRecord, ActualAccount } from '../Types/Index.js';
import { formatDate, toCents, extractQueryData } from '../Utils/Index.js';
import { getLogger } from '../Logger/Index.js';
import type { ICategoryResolver } from './ICategoryResolver.js';

export interface ImportResult {
  imported: number;
  skipped: number;
  newTransactions: TransactionRecord[];
  existingTransactions: TransactionRecord[];
}

export interface ImportTransactionsOpts {
  bankName: string;
  accountNumber: string;
  actualAccountId: string;
  transactions: BankTransaction[];
}

interface SingleTxnContext {
  actualAccountId: string;
  txn: BankTransaction;
  parsed: TransactionRecord;
  importedId: string;
  target: TransactionRecord[];
  existingTransactions: TransactionRecord[];
}

/** Handles importing bank transactions into Actual Budget. */
export class TransactionService {
  private readonly api: typeof api;
  private readonly categoryResolver?: ICategoryResolver;

  /**
   * Creates a TransactionService with the given Actual API and optional category resolver.
   * @param actualApi - The Actual Budget API module for all database operations.
   * @param categoryResolver - Optional resolver to auto-assign categories by description.
   */
  constructor(actualApi: typeof api, categoryResolver?: ICategoryResolver) {
    this.api = actualApi;
    this.categoryResolver = categoryResolver;
  }

  /**
   * Imports transactions for an account into Actual Budget.
   * @param opts - Options including bank name, account number, account ID, and transactions.
   * @returns ImportResult with counts of new and skipped transactions.
   */
  async importTransactions(opts: ImportTransactionsOpts): Promise<ImportResult> {
    getLogger().info(`     📥 Importing ${opts.transactions.length} transactions...`);
    const { newTransactions, existingTransactions } = await this.processTransactionBatch(opts);
    getLogger().info(
      `     ✅ New: ${newTransactions.length}, Existing: ${existingTransactions.length}`
    );
    return {
      imported: newTransactions.length, skipped: existingTransactions.length,
      newTransactions, existingTransactions
    };
  }

  /**
   * Returns an existing Actual account or creates a new one with the given UUID.
   * @param accountId - UUID to look up or create.
   * @param bankName - Bank name used when creating the account label.
   * @param accountNumber - Account number used when creating the account label.
   * @returns The found or newly created ActualAccount.
   */
  async getOrCreateAccount(
    accountId: string, bankName: string, accountNumber: string
  ): Promise<ActualAccount | string> {
    let account: ActualAccount | string | undefined = await this.api.getAccounts()
      .then((accounts: ActualAccount[]) => accounts.find((a) => a.id === accountId));

    if (!account) {
      getLogger().info(`     ➕ Creating new account: ${accountId}`);
      // Actual accepts id to set specific UUID, though not in official type
      account = await this.api.createAccount({
        id: accountId,
        name: `${bankName} - ${accountNumber}`,
        offbudget: false,
        closed: false
      } as Omit<ActualAccount, 'id'>);
    }

    return account;
  }

  /**
   * Iterates the transaction list and separates new from already-imported transactions.
   * @param opts - Import options containing the transactions to process.
   * @returns Object with arrays of new and existing TransactionRecord objects.
   */
  private async processTransactionBatch(
    opts: ImportTransactionsOpts
  ): Promise<{ newTransactions: TransactionRecord[]; existingTransactions: TransactionRecord[] }> {
    const { bankName, accountNumber, actualAccountId, transactions } = opts;
    const newTransactions: TransactionRecord[] = [];
    const existingTransactions: TransactionRecord[] = [];
    const existingIds = await this.getExistingImportedIds(actualAccountId);
    for (const txn of transactions) {
      const parsed = this.parseTransaction(txn);
      const importedId = this.buildImportedId(`${bankName}-${accountNumber}`, txn, parsed);
      const target = existingIds.has(importedId) ? existingTransactions : newTransactions;
      await this.importSingleTransaction(
        { actualAccountId, txn, parsed, importedId, target, existingTransactions }
      );
    }
    return { newTransactions, existingTransactions };
  }

  /**
   * Imports a single transaction into Actual Budget, handling duplicate errors gracefully.
   * @param ctx - Context containing account ID, transaction data, and target arrays.
   */
  private async importSingleTransaction(ctx: SingleTxnContext): Promise<void> {
    const { actualAccountId, txn, parsed, importedId, target, existingTransactions } = ctx;
    try {
      const resolved = this.categoryResolver?.resolve(parsed.description);
      await this.api.importTransactions(actualAccountId, [{
        account: actualAccountId, date: parsed.date, amount: parsed.amount,
        payee_name: resolved?.payeeName ?? parsed.description,
        imported_payee: resolved?.importedPayee,
        imported_id: importedId, category: resolved?.categoryId,
        notes: txn.memo ?? parsed.description, cleared: true
      }]);
      target.push(parsed);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already exists')) { existingTransactions.push(parsed); }
      else { getLogger().error(`     ❌ Error importing transaction: ${msg}`); }
    }
  }

  /**
   * Builds a stable unique identifier for a transaction to detect duplicates.
   * @param accountKey - Combined bank-account string used as a namespace.
   * @param txn - The raw BankTransaction from the scraper.
   * @param parsed - The parsed TransactionRecord with formatted date.
   * @returns A string imported_id for use with Actual's importTransactions API.
   */
  private buildImportedId(accountKey: string, txn: BankTransaction, parsed: TransactionRecord)
    : string {
    const fallback = `${parsed.date}-${txn.chargedAmount ?? txn.originalAmount}`;
    return `${accountKey}-${txn.identifier || fallback}`;
  }

  /**
   * Queries Actual Budget for all imported_id values already in the account.
   * @param accountId - UUID of the Actual account to query.
   * @returns Set of imported_id strings for fast duplicate detection.
   */
  private async getExistingImportedIds(accountId: string): Promise<Set<string>> {
    const result = await this.api.runQuery(
      this.api.q('transactions')
        .filter({ account: accountId, imported_id: { $ne: null } })
        .select(['imported_id'])
    );
    const rows = extractQueryData<Array<{ imported_id: string }>>(result, []);
    return new Set(rows.map((t) => t.imported_id));
  }

  /**
   * Converts a raw BankTransaction from the scraper into a TransactionRecord.
   * @param txn - The raw BankTransaction to convert.
   * @returns A TransactionRecord with formatted date and amount in cents.
   */
  private parseTransaction(txn: BankTransaction): TransactionRecord {
    return {
      date: formatDate(txn.date),
      description: txn.description ?? 'Unknown',
      amount: toCents(txn.chargedAmount ?? txn.originalAmount ?? 0)
    };
  }
}
