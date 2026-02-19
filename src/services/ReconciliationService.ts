/**
 * ReconciliationService - Idempotent reconciliation for bank accounts
 *
 * Prevents duplicate reconciliation transactions by using the same
 * `imported_id` pattern as regular transaction imports.
 */

import type api from '@actual-app/api';
import { formatDate, toCents, extractQueryData } from '../utils/index.js';

export interface ReconciliationResult {
  status: 'created' | 'skipped' | 'already-reconciled';
  diff: number;  // Amount in cents
}

export class ReconciliationService {
  private api: typeof api;

  constructor(actualApi: typeof api) {
    this.api = actualApi;
  }

  async reconcile(accountId: string, expectedBalance: number, currency: string = 'ILS'): Promise<ReconciliationResult> {
    try {
      const actualBalance = await this.getCurrentBalance(accountId);
      const diff = toCents(expectedBalance) - actualBalance;
      if (diff === 0) return { status: 'skipped', diff: 0 };
      await this.createReconciliationTransaction(accountId, diff, expectedBalance, currency);
      return { status: 'created', diff };
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('already exists')) {
        return { status: 'already-reconciled', diff: 0 };
      }
      throw error;
    }
  }

  private async getCurrentBalance(accountId: string): Promise<number> {
    return extractQueryData<number>(
      await this.api.runQuery(
        this.api.q('transactions').filter({ account: accountId }).calculate({ $sum: '$amount' })
      ),
      0
    );
  }

  private async createReconciliationTransaction(
    accountId: string, diff: number, expectedBalance: number, currency: string
  ): Promise<void> {
    const today = formatDate(new Date());
    await this.api.importTransactions(accountId, [{
      account: accountId, date: today, amount: diff,
      payee_name: 'Reconciliation',
      imported_id: `reconciliation-${accountId}-${today}`,
      notes: `Balance adjustment: Expected ${expectedBalance} ${currency}`,
      cleared: true
    }]);
  }
}
