/**
 * SpendingWatchService - Evaluates spending watch rules against transaction history
 * Queries Actual Budget once for the largest time window, then evaluates each rule in-memory.
 */

import type api from '@actual-app/api';

import { getLogger } from '../Logger/Index.js';
import type { ISpendingWatchRule, Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import { errorMessage, extractQueryData, formatDate, fromCents, toCents } from '../Utils/Index.js';

interface ITransactionRow {
  date: string;
  imported_payee: string;
  amount: number;
}

interface IRuleResult {
  rule: ISpendingWatchRule;
  totalSpent: number;
  triggered: boolean;
  matched: ITransactionRow[];
}

const MAX_DISPLAYED_TRANSACTIONS = 5;

/** Evaluates spending watch rules against Actual Budget transaction history. */
export default class SpendingWatchService {
  /**
   * Creates a SpendingWatchService with the given rules and Actual API.
   * @param rules - Array of ISpendingWatchRule configurations to evaluate.
   * @param actualApi - The Actual Budget API module to query transactions from.
   */
  constructor(
    private readonly rules: ISpendingWatchRule[],
    private readonly actualApi: typeof api
  ) {}

  /**
   * Evaluates all configured spending rules and returns a Procedure result.
   * @returns Procedure with alert message when triggered, noAlerts flag when clean, or failure.
   */
  public async evaluate(): Promise<Procedure<{ message: string } | { noAlerts: true }>> {
    if (this.rules.length === 0) return succeed({ noAlerts: true as const }, 'no-alerts');
    try {
      const maxDays = Math.max(...this.rules.map(r => r.numOfDayToCount));
      const allTransactions = await this.queryTransactions(maxDays);
      const results = this.rules.map(r => SpendingWatchService.evaluateRule(r, allTransactions));
      const alertMessage = SpendingWatchService.formatMessage(results);
      if (!alertMessage) return succeed({ noAlerts: true as const }, 'no-alerts');
      return succeed({ message: alertMessage }, 'alert-triggered');
    } catch (error: unknown) {
      getLogger().error(`Spending watch error: ${errorMessage(error)}`);
      const err = error instanceof Error ? error : new Error(String(error));
      const message = errorMessage(error);
      return fail(message, { error: err, status: 'evaluation-error' });
    }
  }

  /**
   * Evaluates a single spending rule against the pre-fetched transaction list.
   * @param rule - The ISpendingWatchRule to evaluate.
   * @param allTransactions - All transactions fetched for the max time window.
   * @returns IRuleResult with totals and trigger status.
   */
  private static evaluateRule(
    rule: ISpendingWatchRule, allTransactions: ITransactionRow[]
  ): IRuleResult {
    const startDate = SpendingWatchService.buildStartDate(rule.numOfDayToCount);
    const inWindow = allTransactions.filter(t => t.date >= startDate);
    const filtered = SpendingWatchService.filterByPayees(inWindow, rule.watchPayees);
    const totalSpent = SpendingWatchService.sumDebits(filtered);
    const threshold = toCents(rule.alertFromAmount);
    return { rule, totalSpent, triggered: totalSpent > threshold, matched: filtered };
  }

  /**
   * Computes the inclusive start date for a rolling window of n days.
   * @param days - Number of days to look back from today.
   * @returns YYYY-MM-DD string for the start of the window.
   */
  private static buildStartDate(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days + 1);
    return formatDate(date);
  }

  /**
   * Queries Actual Budget for all debit transactions within the given window.
   * @param maxDays - Number of days back to query; determines the start date filter.
   * @returns Array of ITransactionRow objects for matching transactions.
   */
  private async queryTransactions(maxDays: number): Promise<ITransactionRow[]> {
    const startDate = SpendingWatchService.buildStartDate(maxDays);
    const query = this.actualApi.q('transactions')
      .filter({ date: { $gte: startDate }, amount: { $lt: 0 } })
      .select(['date', 'imported_payee', 'amount'])
      .orderBy({ date: 'desc' });
    const result = await this.actualApi.aqlQuery(query);
    return extractQueryData<ITransactionRow[]>(result, []);
  }

  /**
   * Filters transactions to only those matching at least one watch payee.
   * @param txns - Full list of transactions in the time window.
   * @param watchPayees - Optional list of payee substrings to filter by; absent means all.
   * @returns Filtered array of transactions matching the payee list.
   */
  private static filterByPayees(
    txns: ITransactionRow[], watchPayees?: string[]
  ): ITransactionRow[] {
    if (!watchPayees || watchPayees.length === 0) return txns;
    const lowerPayees = watchPayees.map(p => p.toLowerCase());
    return txns.filter(t => SpendingWatchService.matchesAnyPayee(t.imported_payee, lowerPayees));
  }

  /**
   * Checks whether a transaction description contains any of the watch payee substrings.
   * @param description - The transaction's imported_payee or description field.
   * @param lowerPayees - Pre-lowercased list of payee substrings to match against.
   * @returns True if the description contains at least one payee substring.
   */
  private static matchesAnyPayee(description: string, lowerPayees: string[]): boolean {
    const lower = (description || '').toLowerCase();
    return lowerPayees.some(p => lower.includes(p));
  }

  /**
   * Sums the absolute values of debit amounts in cents.
   * @param txns - Array of transactions whose amounts to sum.
   * @returns Total absolute debit amount in cents.
   */
  private static sumDebits(txns: ITransactionRow[]): number {
    return txns.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }

  /**
   * Formats triggered rule results into a Telegram HTML alert message.
   * @param results - Array of IRuleResult objects to filter and format.
   * @returns HTML alert string, or empty string when no rules are triggered.
   */
  private static formatMessage(results: IRuleResult[]): string {
    const triggered = results.filter(r => r.triggered);
    if (triggered.length === 0) return '';
    const sections = triggered.map(r => SpendingWatchService.formatRule(r));
    return `🔔 <b>Spending Watch</b>\n\n${sections.join('\n\n')}`;
  }

  /**
   * Formats a single triggered rule result as a multi-line alert section.
   * @param result - The IRuleResult to format.
   * @returns Multi-line string with header and transaction detail lines.
   */
  private static formatRule(result: IRuleResult): string {
    const header = SpendingWatchService.buildRuleHeader(result);
    const details = SpendingWatchService.buildTransactionDetails(result.matched);
    return [header, ...details].filter(Boolean).join('\n');
  }

  /**
   * Builds the header line for a triggered spending rule alert.
   * @param result - The IRuleResult containing the rule and total spent.
   * @returns Header string with payee label, amount, and time window.
   */
  private static buildRuleHeader(result: IRuleResult): string {
    const { rule, totalSpent } = result;
    const payeeLabel = rule.watchPayees?.length ? rule.watchPayees.join(', ') : 'All payees';
    const dayLabel = rule.numOfDayToCount === 1
      ? '1 day'
      : `${String(rule.numOfDayToCount)} days`;
    return (
      `⚠️ ${payeeLabel}: ${SpendingWatchService.formatAmount(totalSpent)} in ${dayLabel} ` +
      `(limit: ${rule.alertFromAmount.toLocaleString()})`
    );
  }

  /**
   * Formats up to 5 matched transactions as detail lines, with an overflow notice.
   * @param matched - Array of matching ITransactionRow objects to display.
   * @returns Array of formatted detail strings for the alert message.
   */
  private static buildTransactionDetails(matched: ITransactionRow[]): string[] {
    const lines = matched.slice(0, MAX_DISPLAYED_TRANSACTIONS)
      .map(t =>
        `  ${SpendingWatchService.formatAmount(t.amount)}  ${t.imported_payee || 'Unknown'}`
      );
    if (matched.length > MAX_DISPLAYED_TRANSACTIONS) {
      lines.push(
        `  ... and ${String(matched.length - MAX_DISPLAYED_TRANSACTIONS)} more`
      );
    }
    return lines;
  }

  /**
   * Converts a cent amount to a locale-formatted currency string.
   * @param cents - The amount in cents to format.
   * @returns Formatted string like "1,234.56".
   */
  private static formatAmount(cents: number): string {
    return fromCents(cents).toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
