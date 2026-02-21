/**
 * SpendingWatchService - Evaluates spending watch rules against transaction history
 * Queries Actual Budget for transactions in the configured time window,
 * filters by payees if configured, and triggers alerts when thresholds are exceeded.
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

export class SpendingWatchService {
  constructor(
    private rules: SpendingWatchRule[],
    private actualApi: typeof api
  ) {}

  async evaluate(): Promise<string | null> {
    if (this.rules.length === 0) return null;
    try {
      const results = await Promise.all(this.rules.map(r => this.evaluateRule(r)));
      return this.formatMessage(results);
    } catch (error: unknown) {
      getLogger().error(`Spending watch error: ${errorMessage(error)}`);
      return null;
    }
  }

  private async evaluateRule(rule: SpendingWatchRule): Promise<RuleResult> {
    const startDate = this.buildStartDate(rule.numOfDayToCount);
    const transactions = await this.queryTransactions(startDate);
    const filtered = this.filterByPayees(transactions, rule.watchPayees);
    const totalSpent = this.sumDebits(filtered);
    const threshold = toCents(rule.alertFromAmount);
    return { rule, totalSpent, triggered: totalSpent > threshold, matched: filtered };
  }

  private buildStartDate(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days + 1);
    return formatDate(date);
  }

  private async queryTransactions(startDate: string): Promise<TransactionRow[]> {
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
    const { rule, totalSpent, matched } = result;
    const payeeLabel = rule.watchPayees?.length ? rule.watchPayees.join(', ') : 'All payees';
    const dayLabel = rule.numOfDayToCount === 1 ? '1 day' : `${rule.numOfDayToCount} days`;
    const header = `⚠️ ${payeeLabel}: ${this.fmtAmount(totalSpent)} in ${dayLabel} (limit: ${rule.alertFromAmount.toLocaleString()})`;
    const details = matched.slice(0, 5).map(t => `  ${this.fmtAmount(t.amount)}  ${t.imported_payee}`);
    const overflow = matched.length > 5 ? `  ... and ${matched.length - 5} more` : '';
    return [header, ...details, overflow].filter(Boolean).join('\n');
  }

  private fmtAmount(cents: number): string {
    return fromCents(cents).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
