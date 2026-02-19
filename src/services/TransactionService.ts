/**
 * TransactionService - Handles transaction import into Actual Budget
 * Follows Single Responsibility Principle: Only handles transaction import logic
 */

import type api from '@actual-app/api';
import { BankTransaction, TransactionRecord } from '../types/index.js';
import { formatDate, toCents } from '../utils/index.js';

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
    bankName: string,
    accountNumber: string,
    actualAccountId: string,
    transactions: BankTransaction[]
  ): Promise<ImportResult> {
    let imported = 0;
    let skipped = 0;
    const newTransactions: TransactionRecord[] = [];
    const existingTransactions: TransactionRecord[] = [];

    console.log(`     📥 Importing ${transactions.length} transactions...`);

    const existingIds = await this.getExistingImportedIds(actualAccountId);

    for (const txn of transactions) {
      const parsed = this.parseTransaction(txn);
      const importedId = this.buildImportedId(bankName, accountNumber, txn, parsed);
      const target = existingIds.has(importedId) ? existingTransactions : newTransactions;

      try {
        await this.api.importTransactions(actualAccountId, [{
          account: actualAccountId,
          date: parsed.date,
          amount: parsed.amount,
          payee_name: parsed.description,
          imported_id: importedId,
          notes: txn.memo ?? parsed.description,
          cleared: true
        }]);
        target.push(parsed);
      } catch (error: any) {
        if (error.message?.includes('already exists')) {
          existingTransactions.push(parsed);
        } else {
          console.error(`     ❌ Error importing transaction:`, error.message);
        }
      }
    }

    imported = newTransactions.length;
    skipped = existingTransactions.length;
    console.log(`     ✅ New: ${imported}, Existing: ${skipped}`);
    return { imported, skipped, newTransactions, existingTransactions };
  }

  /**
   * Get an existing account or create a new one in Actual Budget
   */
  async getOrCreateAccount(
    accountId: string,
    bankName: string,
    accountNumber: string
  ): Promise<any> {
    let account = await this.api.getAccounts().then((accounts: any[]) =>
      accounts.find((a: any) => a.id === accountId)
    );

    if (!account) {
      console.log(`     ➕ Creating new account: ${accountId}`);
      account = await this.api.createAccount({
        id: accountId,
        name: `${bankName} - ${accountNumber}`,
        offbudget: false,
        closed: false
      } as any);
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
    const result: any = await this.api.runQuery(
      this.api.q('transactions')
        .filter({ account: accountId, imported_id: { $ne: null } })
        .select(['imported_id'])
    );
    const ids = (result?.data ?? []).map((t: any) => t.imported_id);
    return new Set(ids);
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
