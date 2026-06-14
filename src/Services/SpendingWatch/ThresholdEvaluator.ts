import type { ISpendingWatchRule } from '../../Types/Index.js';
import { formatDate, toCents } from '../../Utils/Index.js';
import type { IRuleResult, ITransactionRow } from './Types.js';

/** Evaluates one spending rule against the prefetched transaction window.
 * @param rule spending-watch rule to evaluate.
 * @param allTransactions transactions fetched for the widest rule window.
 * @returns rule evaluation result with totals and matched transactions. */
export function evaluateRule(
  rule: ISpendingWatchRule, allTransactions: ITransactionRow[]
): IRuleResult {
  const startDate = buildStartDate(rule.numOfDayToCount);
  const inWindow = allTransactions.filter(transaction => transaction.date >= startDate);
  const filtered = filterByPayees(inWindow, rule.watchPayees);
  const totalSpent = sumDebits(filtered);
  const threshold = toCents(rule.alertFromAmount);
  return { rule, totalSpent, triggered: totalSpent > threshold, matched: filtered };
}

/** Builds the inclusive start date for a rolling day window.
 * @param days number of days to include.
 * @returns ISO date string for the first included day. */
export function buildStartDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days + 1);
  return formatDate(date);
}

/** Filters transactions by optional payee substrings.
 * @param transactions candidate transactions.
 * @param watchPayees optional configured payee substrings.
 * @returns transactions matching the configured payees. */
export function filterByPayees(
  transactions: ITransactionRow[], watchPayees?: string[]
): ITransactionRow[] {
  if (!watchPayees?.length) return transactions;
  const lowerPayees = watchPayees.map(payee => payee.toLowerCase());
  return transactions.filter(transaction =>
    matchesAnyPayee(transaction.imported_payee, lowerPayees)
  );
}

/** Checks whether a transaction payee contains any watched substring.
 * @param description imported transaction payee text.
 * @param lowerPayees lower-cased watched payee substrings.
 * @returns true when any watched payee appears in the description. */
export function matchesAnyPayee(description: string, lowerPayees: string[]): boolean {
  const lowerDescription = (description || '').toLowerCase();
  return lowerPayees.some(payee => lowerDescription.includes(payee));
}

/** Sums absolute debit amounts in cents.
 * @param transactions matched debit transactions.
 * @returns total absolute debit amount in cents. */
export function sumDebits(transactions: ITransactionRow[]): number {
  return transactions.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
}
