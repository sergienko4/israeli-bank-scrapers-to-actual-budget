import type api from '@actual-app/api';

import { getLogger } from '../../Logger/Index.js';
import { buildStartDate } from './ThresholdEvaluator.js';
import type { ITransactionRow } from './Types.js';
interface ITransactionQueryResult { data?: ITransactionRow[] }
type TransactionQueryResult = ITransactionQueryResult | null;
type ActualQuery = Parameters<typeof api.aqlQuery>[0];
/** Queries Actual Budget for debit transactions in the requested window.
 * @param actualApi Actual Budget API module.
 * @param maxDays widest spending-watch window in days.
 * @returns transactions returned by Actual Budget, or an empty list. */
export default async function queryTransactions(
  actualApi: typeof api, maxDays: number
): Promise<ITransactionRow[]> {
  const query = buildDebitTransactionQuery(actualApi, maxDays);
  const result = await actualApi.aqlQuery(query) as TransactionQueryResult;
  return extractTransactionData(result);
}
/** Builds the Actual Budget debit transaction query.
 * @param actualApi Actual Budget API module.
 * @param maxDays widest spending-watch window in days.
 * @returns Actual AQL query object. */
function buildDebitTransactionQuery(actualApi: typeof api, maxDays: number): ActualQuery {
  const startDate = buildStartDate(maxDays);
  return actualApi.q('transactions')
    .filter({ date: { $gte: startDate }, amount: { $lt: 0 } })
    .select(['date', 'imported_payee', 'amount'])
    .orderBy({ date: 'desc' });
}
/** Extracts query rows while preserving the legacy no-data warning.
 * @param result Actual Budget AQL result.
 * @returns transaction rows or an empty list when data is absent. */
function extractTransactionData(result: TransactionQueryResult): ITransactionRow[] {
  if (!result?.data) {
    getLogger().warn('Spending watch query returned no data — verify account has transactions');
    return [];
  }
  return result.data;
}
