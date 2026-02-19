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

  /**
   * Reconcile account balance with idempotent duplicate prevention
   *
   * @param accountId - Actual Budget account ID
   * @param expectedBalance - Expected balance in currency units (not cents!)
   * @param currency - Currency code (default: 'ILS')
   * @returns ReconciliationResult with status and difference
   */
  async reconcile(
    accountId: string,
    expectedBalance: number,
    currency: string = 'ILS'
  ): Promise<ReconciliationResult> {
    try {
      // 1. Get current account balance from Actual Budget
      const actualBalance = extractQueryData<number>(
        await this.api.runQuery(
          this.api.q('transactions')
            .filter({ account: accountId })
            .calculate({ $sum: '$amount' })
        ),
        0
      );

      // 2. Calculate difference
      const expectedBalanceCents = toCents(expectedBalance);
      const diff = expectedBalanceCents - actualBalance;

      // 3. Skip if already balanced (within 1 cent tolerance for rounding)
      if (Math.abs(diff) === 0) {
        return { status: 'skipped', diff: 0 };
      }

      // 4. Create reconciliation transaction with unique imported_id
      // This prevents duplicates - one reconciliation per account per day
      const today = formatDate(new Date());
      const reconciliationId = `reconciliation-${accountId}-${today}`;

      await this.api.importTransactions(accountId, [{
        account: accountId,
        date: today,
        amount: diff,
        payee_name: 'Reconciliation',
        imported_id: reconciliationId,  // KEY: Prevents duplicates!
        notes: `Balance adjustment: Expected ${expectedBalance} ${currency}`,
        cleared: true
      }]);

      return { status: 'created', diff };
    } catch (error: unknown) {
      // If duplicate, it means reconciliation already exists for today
      if (error instanceof Error && error.message.includes('already exists')) {
        return { status: 'already-reconciled', diff: 0 };
      }
      throw error;
    }
  }
}
