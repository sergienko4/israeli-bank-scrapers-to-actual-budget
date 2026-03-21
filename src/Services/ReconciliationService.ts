/**
 * ReconciliationService - Idempotent reconciliation for bank accounts
 *
 * Prevents duplicate reconciliation transactions by using the same
 * `imported_id` pattern as regular transaction imports.
 */

import type api from '@actual-app/api';

import type { Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import { extractQueryData,formatDate, toCents } from '../Utils/Index.js';

export interface IReconciliationResult {
  status: 'created' | 'skipped' | 'already-reconciled';
  diff: number;  // Amount in cents
}

interface IReconciliationTxn {
  accountId: string;
  diff: number;
  expectedBalance: number;
  currency: string;
}

/** Creates idempotent balance-adjustment transactions in Actual Budget. */
export class ReconciliationService {
  private readonly _api: typeof api;

  /**
   * Creates a ReconciliationService using the given Actual API instance.
   * @param actualApi - The Actual Budget API module to use for queries and imports.
   */
  constructor(actualApi: typeof api) {
    this._api = actualApi;
  }

  /**
   * Reconciles an Actual account to match the expected bank balance.
   * @param accountId - UUID of the Actual account to reconcile.
   * @param expectedBalance - The bank-reported balance in currency units.
   * @param currency - Currency code for the adjustment note (default 'ILS').
   * @returns Procedure containing the reconciliation result or a failure message.
   */
  public async reconcile(
    accountId: string, expectedBalance: number, currency = 'ILS'
  ): Promise<Procedure<IReconciliationResult>> {
    try {
      const actualBalance = await this.getCurrentBalance(accountId);
      const diff = toCents(expectedBalance) - actualBalance;
      if (diff === 0) return succeed({ status: 'skipped', diff: 0 });
      await this.createReconciliationTransaction({ accountId, diff, expectedBalance, currency });
      return succeed({ status: 'created', diff });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('already exists')) {
        return succeed({ status: 'already-reconciled', diff: 0 });
      }
      const wrappedError = error instanceof Error ? error : new Error(String(error));
      return fail(`Reconciliation failed: ${wrappedError.message}`, {
        error: wrappedError, status: 'reconciliation-error',
      });
    }
  }

  /**
   * Queries Actual Budget for the current sum of all transactions in an account.
   * @param accountId - UUID of the Actual account to query.
   * @returns The current balance in cents as a number.
   */
  private async getCurrentBalance(accountId: string): Promise<number> {
    const query = this._api.q('transactions')
      .filter({ account: accountId })
      .calculate({ $sum: '$amount' });
    const queryResult = await this._api.aqlQuery(query);
    return extractQueryData<number>(queryResult, 0);
  }

  /**
   * Imports a balance-adjustment transaction into Actual Budget.
   * @param txn - The reconciliation transaction parameters including diff and account ID.
   */
  private async createReconciliationTransaction(txn: IReconciliationTxn): Promise<void> {
    const today = formatDate(new Date());
    await this._api.importTransactions(txn.accountId, [{
      account: txn.accountId, date: today, amount: txn.diff,
      payee_name: 'Reconciliation',
      imported_id: `reconciliation-${txn.accountId}-${today}`,
      notes: `Balance adjustment: Expected ${String(txn.expectedBalance)} ${txn.currency}`,
      cleared: true
    }]);
  }
}
