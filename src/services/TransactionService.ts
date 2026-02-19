/**
 * TransactionService - Handles transaction import into Actual Budget
 * Follows Single Responsibility Principle: Only handles transaction import logic
 */

import type api from '@actual-app/api';
import { BankTransaction, TransactionRecord, ActualAccount } from '../types/index.js';
import { formatDate, toCents, extractQueryData } from '../utils/index.js';

export interface ImportResult {
  imported: number;
  skipped: number;
  newTransactions: TransactionRecord[];
  existingTransactions: TransactionRecord[];
}

export class TransactionService {
  private api: typeof api;

  constructor(actualApi: typeof api) {
    this.api = actualApi;
  }

  /**
   * Import transactions for an account into Actual Budget
   *
   * @param bankName - Bank identifier for imported_id generation
   * @param accountNumber - Bank account number
   * @param actualAccountId - Actual Budget account ID
   * @param transactions - Array of bank transactions to import
   * @returns ImportResult with imported and skipped counts
   */
  async importTransactions(
    bankName: string, accountNumber: string,
    actualAccountId: string, transactions: BankTransaction[]
  ): Promise<ImportResult> {
    const newTransactions: TransactionRecord[] = [];
    const existingTransactions: TransactionRecord[] = [];
    console.log(`     📥 Importing ${transactions.length} transactions...`);

    const existingIds = await this.getExistingImportedIds(actualAccountId);
    for (const txn of transactions) {
      const parsed = this.parseTransaction(txn);
      const importedId = this.buildImportedId(bankName, accountNumber, txn, parsed);
      const target = existingIds.has(importedId) ? existingTransactions : newTransactions;
      await this.importSingleTransaction(actualAccountId, txn, parsed, importedId, target, existingTransactions);
    }

    console.log(`     ✅ New: ${newTransactions.length}, Existing: ${existingTransactions.length}`);
    return { imported: newTransactions.length, skipped: existingTransactions.length, newTransactions, existingTransactions };
  }

  private async importSingleTransaction(
    actualAccountId: string, txn: BankTransaction, parsed: TransactionRecord,
    importedId: string, target: TransactionRecord[], existingTransactions: TransactionRecord[]
  ): Promise<void> {
    try {
      await this.api.importTransactions(actualAccountId, [{
        account: actualAccountId, date: parsed.date, amount: parsed.amount,
        payee_name: parsed.description, imported_id: importedId,
        notes: txn.memo ?? parsed.description, cleared: true
      }]);
      target.push(parsed);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already exists')) { existingTransactions.push(parsed); }
      else { console.error(`     ❌ Error importing transaction:`, msg); }
    }
  }

  /**
   * Get an existing account or create a new one in Actual Budget
   */
  async getOrCreateAccount(
    accountId: string,
    bankName: string,
    accountNumber: string
  ): Promise<ActualAccount | string> {
    let account: ActualAccount | string | undefined = await this.api.getAccounts()
      .then((accounts: ActualAccount[]) => accounts.find((a) => a.id === accountId));

    if (!account) {
      console.log(`     ➕ Creating new account: ${accountId}`);
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
   * Get all existing imported_ids for an account
   */
  private buildImportedId(
    bankName: string, accountNumber: string,
    txn: BankTransaction, parsed: TransactionRecord
  ): string {
    return `${bankName}-${accountNumber}-${txn.identifier || `${parsed.date}-${txn.chargedAmount || txn.originalAmount}`}`;
  }

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
   * Convert external bank transaction to typed internal format
   */
  private parseTransaction(txn: BankTransaction): TransactionRecord {
    return {
      date: formatDate(txn.date),
      description: txn.description ?? 'Unknown',
      amount: toCents(txn.chargedAmount ?? txn.originalAmount ?? 0)
    };
  }
}
