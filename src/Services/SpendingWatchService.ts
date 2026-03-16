/**
 * SpendingWatchService - Evaluates spending watch rules against transaction history
 * Queries Actual Budget once for the largest time window, then evaluates each rule in-memory.
 */

import type api from '@actual-app/api';
import type { SpendingWatchRule } from '../Types/Index.js';
import { toCents, fromCents, formatDate, extractQueryData, errorMessage } from '../Utils/Index.js';
import { getLogger } from '../Logger/Index.js';

interface TransactionRow {
  date: string;
  imported_payee: string;
  amount: number;
}

interface RuleResult {
  rule: SpendingWatchRule;
  totalSpent: number;
  triggered: boolean;
  matched: TransactionRow[];
}

const MAX_DISPLAYED_TRANSACTIONS = 5;

/** Evaluates spending watch rules against Actual Budget transaction history. */
export class SpendingWatchService {
  /**
   * Creates a SpendingWatchService with the given rules and Actual API.
   * @param rules - Array of SpendingWatchRule configurations to evaluate.
   * @param actualApi - The Actual Budget API module to query transactions from.
   */
  constructor(
    private readonly rules: SpendingWatchRule[],
    private readonly actualApi: typeof api
  ) {}

  /**
   * Evaluates all configured spending rules and returns a formatted alert message.
   * @returns HTML alert string when any rule is triggered, or null if none are.
   */
  async evaluate(): Promise<string | null> {
    if (this.rules.length === 0) return null;
    try {
      const maxDays = Math.max(...this.rules.map(r => r.numOfDayToCount));
      const allTransactions = await this.queryTransactions(maxDays);
      const results = this.rules.map(r => this.evaluateRule(r, allTransactions));
      return this.formatMessage(results);
    } catch (error: unknown) {
      getLogger().error(`Spending watch error: ${errorMessage(error)}`);
      return null;
    }
  }

  /**
   * Evaluates a single spending rule against the pre-fetched transaction list.
   * @param rule - The SpendingWatchRule to evaluate.
   * @param allTransactions - All transactions fetched for the max time window.
   * @returns RuleResult with totals and trigger status.
   */
  private evaluateRule(rule: SpendingWatchRule, allTransactions: TransactionRow[]): RuleResult {
    const startDate = this.buildStartDate(rule.numOfDayToCount);
    const inWindow = allTransactions.filter(t => t.date >= startDate);
    const filtered = this.filterByPayees(inWindow, rule.watchPayees);
    const totalSpent = this.sumDebits(filtered);
    const threshold = toCents(rule.alertFromAmount);
    return { rule, totalSpent, triggered: totalSpent > threshold, matched: filtered };
  }

  /**
   * Computes the inclusive start date for a rolling window of n days.
   * @param days - Number of days to look back from today.
   * @returns YYYY-MM-DD string for the start of the window.
   */
  private buildStartDate(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days + 1);
    return formatDate(date);
  }

  /**
   * Queries Actual Budget for all debit transactions within the given window.
   * @param maxDays - Number of days back to query; determines the start date filter.
   * @returns Array of TransactionRow objects for matching transactions.
   */
  private async queryTransactions(maxDays: number): Promise<TransactionRow[]> {
    const startDate = this.buildStartDate(maxDays);
    const result = await this.actualApi.runQuery(
      this.actualApi.q('transactions')
        .filter({ date: { $gte: startDate }, amount: { $lt: 0 } })
        .select(['date', 'imported_payee', 'amount'])
        .orderBy({ date: 'desc' })
    );
    return extractQueryData<TransactionRow[]>(result, []);
  }

  /**
   * Filters transactions to only those matching at least one watch payee.
   * @param txns - Full list of transactions in the time window.
   * @param watchPayees - Optional list of payee substrings to filter by; absent means all.
   * @returns Filtered array of transactions matching the payee list.
   */
  private filterByPayees(txns: TransactionRow[], watchPayees?: string[]): TransactionRow[] {
    if (!watchPayees || watchPayees.length === 0) return txns;
    const lowerPayees = watchPayees.map(p => p.toLowerCase());
    return txns.filter(t => this.matchesAnyPayee(t.imported_payee, lowerPayees));
  }

  /**
   * Checks whether a transaction description contains any of the watch payee substrings.
   * @param description - The transaction's imported_payee or description field.
   * @param lowerPayees - Pre-lowercased list of payee substrings to match against.
   * @returns True if the description contains at least one payee substring.
   */
  private matchesAnyPayee(description: string, lowerPayees: string[]): boolean {
    const lower = (description || '').toLowerCase();
    return lowerPayees.some(p => lower.includes(p));
  }

  /**
   * Sums the absolute values of debit amounts in cents.
   * @param txns - Array of transactions whose amounts to sum.
   * @returns Total absolute debit amount in cents.
   */
  private sumDebits(txns: TransactionRow[]): number {
    return txns.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }

  /**
   * Formats triggered rule results into a Telegram HTML alert message.
   * @param results - Array of RuleResult objects to filter and format.
   * @returns HTML alert string, or null when no rules are triggered.
   */
  private formatMessage(results: RuleResult[]): string | null {
    const triggered = results.filter(r => r.triggered);
    if (triggered.length === 0) return null;
    const sections = triggered.map(r => this.formatRule(r));
    return `🔔 <b>Spending Watch</b>\n\n${sections.join('\n\n')}`;
  }

  /**
   * Formats a single triggered rule result as a multi-line alert section.
   * @param result - The RuleResult to format.
   * @returns Multi-line string with header and transaction detail lines.
   */
  private formatRule(result: RuleResult): string {
    const header = this.buildRuleHeader(result);
    const details = this.buildTransactionDetails(result.matched);
    return [header, ...details].filter(Boolean).join('\n');
  }

  /**
   * Builds the header line for a triggered spending rule alert.
   * @param result - The RuleResult containing the rule and total spent.
   * @returns Header string with payee label, amount, and time window.
   */
  private buildRuleHeader(result: RuleResult): string {
    const { rule, totalSpent } = result;
    const payeeLabel = rule.watchPayees?.length ? rule.watchPayees.join(', ') : 'All payees';
    const dayLabel = rule.numOfDayToCount === 1 ? '1 day' : `${rule.numOfDayToCount} days`;
    return (
      `⚠️ ${payeeLabel}: ${this.formatAmount(totalSpent)} in ${dayLabel} ` +
      `(limit: ${rule.alertFromAmount.toLocaleString()})`
    );
  }

  /**
   * Formats up to 5 matched transactions as detail lines, with an overflow notice.
   * @param matched - Array of matching TransactionRow objects to display.
   * @returns Array of formatted detail strings for the alert message.
   */
  private buildTransactionDetails(matched: TransactionRow[]): string[] {
    const lines = matched.slice(0, MAX_DISPLAYED_TRANSACTIONS)
      .map(t => `  ${this.formatAmount(t.amount)}  ${t.imported_payee || 'Unknown'}`);
    if (matched.length > MAX_DISPLAYED_TRANSACTIONS) {
      lines.push(`  ... and ${matched.length - MAX_DISPLAYED_TRANSACTIONS} more`);
    }
    return lines;
  }

  /**
   * Converts a cent amount to a locale-formatted currency string.
   * @param cents - The amount in cents to format.
   * @returns Formatted string like "1,234.56".
   */
  private formatAmount(cents: number): string {
    return fromCents(cents).toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
