/**
 * TransactionService - Handles transaction import into Actual Budget
 * Follows Single Responsibility Principle: Only handles transaction import logic
 */

import type api from '@actual-app/api';
import { BankTransaction } from '../types/index.js';
import { formatDate, toCents } from '../utils/index.js';

export interface ImportedTransaction {
  date: string;
  description: string;
  amount: number; // in cents
}

export interface ImportResult {
  imported: number;
  skipped: number;
  transactions: ImportedTransaction[];
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
    const importedTxns: ImportedTransaction[] = [];

    console.log(`     📥 Importing ${transactions.length} transactions...`);

    for (const txn of transactions) {
      try {
        const importedId = `${bankName}-${accountNumber}-${txn.identifier || `${formatDate(txn.date)}-${txn.chargedAmount || txn.originalAmount}`}`;
        const amount = toCents(txn.chargedAmount ?? txn.originalAmount ?? 0);
        const date = formatDate(txn.date);
        const description = txn.description || 'Unknown';

        const transaction = {
          account: actualAccountId,
          date,
          amount,
          payee_name: description,
          imported_id: importedId,
          notes: txn.memo || txn.description || '',
          cleared: true
        };

        await this.api.importTransactions(actualAccountId, [transaction]);
        imported++;
        importedTxns.push({ date, description, amount });
      } catch (error: any) {
        if (error.message && error.message.includes('already exists')) {
          skipped++;
        } else {
          console.error(`     ❌ Error importing transaction:`, error.message);
        }
      }
    }

    console.log(`     ✅ Imported: ${imported}, Skipped (duplicates): ${skipped}`);
    return { imported, skipped, transactions: importedTxns };
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
}
