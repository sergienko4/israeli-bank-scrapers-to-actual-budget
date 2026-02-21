/**
 * SpendingWatchService - Evaluates spending watch rules against transaction history
 * Queries Actual Budget once for the largest time window, then evaluates each rule in-memory.
 */

import type api from '@actual-app/api';
import { SpendingWatchRule } from '../types/index.js';
import { toCents, fromCents, formatDate, extractQueryData, errorMessage } from '../utils/index.js';
import { getLogger } from '../logger/index.js';

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

export class SpendingWatchService {
  constructor(
    private rules: SpendingWatchRule[],
    private actualApi: typeof api
  ) {}

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

  private evaluateRule(rule: SpendingWatchRule, allTransactions: TransactionRow[]): RuleResult {
    const startDate = this.buildStartDate(rule.numOfDayToCount);
    const inWindow = allTransactions.filter(t => t.date >= startDate);
    const filtered = this.filterByPayees(inWindow, rule.watchPayees);
    const totalSpent = this.sumDebits(filtered);
    const threshold = toCents(rule.alertFromAmount);
    return { rule, totalSpent, triggered: totalSpent > threshold, matched: filtered };
  }

  private buildStartDate(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days + 1);
    return formatDate(date);
  }

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

  private filterByPayees(txns: TransactionRow[], watchPayees?: string[]): TransactionRow[] {
    if (!watchPayees || watchPayees.length === 0) return txns;
    const lowerPayees = watchPayees.map(p => p.toLowerCase());
    return txns.filter(t => this.matchesAnyPayee(t.imported_payee, lowerPayees));
  }

  private matchesAnyPayee(description: string, lowerPayees: string[]): boolean {
    const lower = (description || '').toLowerCase();
    return lowerPayees.some(p => lower.includes(p));
  }

  private sumDebits(txns: TransactionRow[]): number {
    return txns.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }

  private formatMessage(results: RuleResult[]): string | null {
    const triggered = results.filter(r => r.triggered);
    if (triggered.length === 0) return null;
    const sections = triggered.map(r => this.formatRule(r));
    return `🔔 <b>Spending Watch</b>\n\n${sections.join('\n\n')}`;
  }

  private formatRule(result: RuleResult): string {
    const header = this.buildRuleHeader(result);
    const details = this.buildTransactionDetails(result.matched);
    return [header, ...details].filter(Boolean).join('\n');
  }

  private buildRuleHeader(result: RuleResult): string {
    const { rule, totalSpent } = result;
    const payeeLabel = rule.watchPayees?.length ? rule.watchPayees.join(', ') : 'All payees';
    const dayLabel = rule.numOfDayToCount === 1 ? '1 day' : `${rule.numOfDayToCount} days`;
    return `⚠️ ${payeeLabel}: ${this.formatAmount(totalSpent)} in ${dayLabel} (limit: ${rule.alertFromAmount.toLocaleString()})`;
  }

  private buildTransactionDetails(matched: TransactionRow[]): string[] {
    const lines = matched.slice(0, MAX_DISPLAYED_TRANSACTIONS)
      .map(t => `  ${this.formatAmount(t.amount)}  ${t.imported_payee}`);
    if (matched.length > MAX_DISPLAYED_TRANSACTIONS) {
      lines.push(`  ... and ${matched.length - MAX_DISPLAYED_TRANSACTIONS} more`);
    }
    return lines;
  }

  private formatAmount(cents: number): string {
    return fromCents(cents).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
