/**
 * ReconciliationService - Idempotent reconciliation for bank accounts
 *
 * Prevents duplicate reconciliation transactions by using the same
 * `imported_id` pattern as regular transaction imports.
 */

import type api from '@actual-app/api';
import { formatDate, toCents, extractQueryData } from '../Utils/Index.js';

export interface ReconciliationResult {
  status: 'created' | 'skipped' | 'already-reconciled';
  diff: number;  // Amount in cents
}

interface ReconciliationTxn {
  accountId: string;
  diff: number;
  expectedBalance: number;
  currency: string;
}

/** Creates idempotent balance-adjustment transactions in Actual Budget. */
export class ReconciliationService {
  private api: typeof api;

  /**
   * Creates a ReconciliationService using the given Actual API instance.
   * @param actualApi - The Actual Budget API module to use for queries and imports.
   */
  constructor(actualApi: typeof api) {
    this.api = actualApi;
  }

  /**
   * Reconciles an Actual account to match the expected bank balance.
   * @param accountId - UUID of the Actual account to reconcile.
   * @param expectedBalance - The bank-reported balance in currency units.
   * @param currency - Currency code for the adjustment note (default 'ILS').
   * @returns Result indicating whether a transaction was created, skipped, or already existed.
   */
  async reconcile(
    accountId: string, expectedBalance: number, currency: string = 'ILS'
  ): Promise<ReconciliationResult> {
    try {
      const actualBalance = await this.getCurrentBalance(accountId);
      const diff = toCents(expectedBalance) - actualBalance;
      if (diff === 0) return { status: 'skipped', diff: 0 };
      await this.createReconciliationTransaction({ accountId, diff, expectedBalance, currency });
      return { status: 'created', diff };
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('already exists')) {
        return { status: 'already-reconciled', diff: 0 };
      }
      throw error;
    }
  }

  /**
   * Queries Actual Budget for the current sum of all transactions in an account.
   * @param accountId - UUID of the Actual account to query.
   * @returns The current balance in cents as a number.
   */
  private async getCurrentBalance(accountId: string): Promise<number> {
    return extractQueryData<number>(
      await this.api.runQuery(
        this.api.q('transactions')
          .filter({ account: accountId })
          .calculate({ $sum: '$amount' })
      ),
      0
    );
  }

  /**
   * Imports a balance-adjustment transaction into Actual Budget.
   * @param txn - The reconciliation transaction parameters including diff and account ID.
   */
  private async createReconciliationTransaction(txn: ReconciliationTxn): Promise<void> {
    const today = formatDate(new Date());
    await this.api.importTransactions(txn.accountId, [{
      account: txn.accountId, date: today, amount: txn.diff,
      payee_name: 'Reconciliation',
      imported_id: `reconciliation-${txn.accountId}-${today}`,
      notes: `Balance adjustment: Expected ${txn.expectedBalance} ${txn.currency}`,
      cleared: true
    }]);
  }
}
