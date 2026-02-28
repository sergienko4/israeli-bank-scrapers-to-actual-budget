/**
 * DryRunCollector — collects and formats account preview data in dry-run mode
 * No writes to Actual Budget; shows what WOULD be imported.
 */

import { BankTransaction } from '../Types/index.js';
import { formatDate } from '../Utils/index.js';

/** Preview data for a single scraped account in dry-run mode. */
export interface AccountPreview {
  bankName: string;
  accountNumber: string;
  balance: number | undefined;
  currency: string;
  transactionCount: number;
  dateRange: { from: string; to: string };
  samples: Array<{ date: string; description: string; amount: number }>;
}

/** Input to {@link DryRunCollector.buildPreview} — raw data from a scraped account. */
export interface PreviewInput {
  bankName: string;
  accountNumber: string;
  balance: number | undefined;
  currency: string;
  txns: BankTransaction[];
}

/**
 * Collects and formats account preview data when `DRY_RUN=true`.
 *
 * No data is written to Actual Budget — this service only reads scraped results
 * and formats them for CLI and Telegram output.
 */
export class DryRunCollector {
  private accounts: AccountPreview[] = [];

  recordAccount(preview: AccountPreview): void {
    this.accounts.push(preview);
  }

  getPreview(): AccountPreview[] { return this.accounts; }

  hasAccounts(): boolean { return this.accounts.length > 0; }

  totalTransactions(): number {
    return this.accounts.reduce((sum, a) => sum + a.transactionCount, 0);
  }

  formatText(): string {
    const lines = ['\n🔍 DRY RUN — no changes made to Actual Budget', '═'.repeat(50)];
    for (const a of this.accounts) lines.push(...this.accountTextLines(a));
    lines.push('═'.repeat(50), this.summaryLine());
    return lines.join('\n');
  }

  formatTelegram(): string {
    const lines = ['🔍 <b>Dry Run Preview</b> — no changes made', ''];
    for (const a of this.accounts) lines.push(...this.accountTelegramLines(a));
    lines.push(this.summaryLine());
    return lines.join('\n');
  }

  static buildPreview(input: PreviewInput): AccountPreview {
    const { bankName, accountNumber, balance, currency, txns } = input;
    return {
      bankName, accountNumber, balance, currency,
      transactionCount: txns.length,
      dateRange: DryRunCollector.computeDateRange(txns),
      samples: txns.slice(0, 3).map(tx => DryRunCollector.parseSample(tx)),
    };
  }

  // ─── Private helpers ───

  private summaryLine(): string {
    const n = this.accounts.length;
    const t = this.totalTransactions();
    return `Total: ${n} account${n !== 1 ? 's' : ''}, ` +
      `${t} transaction${t !== 1 ? 's' : ''} (0 imported — dry run)`;
  }

  private accountTextLines(a: AccountPreview): string[] {
    const header = [
      `\n📊 ${a.bankName}  💳 ${a.accountNumber}`,
      `  Balance: ${this.formatBalance(a.balance, a.currency)}`,
      `  Transactions: ${a.transactionCount}  (${a.dateRange.from} → ${a.dateRange.to})`,
    ];
    if (a.samples.length === 0) return header;
    return [...header, '  Recent:', ...this.formatSampleLines(a.samples, a.currency)];
  }

  private accountTelegramLines(a: AccountPreview): string[] {
    const bal = this.formatBalance(a.balance, a.currency);
    const range = `${a.dateRange.from} → ${a.dateRange.to}`;
    return [
      `💳 <b>${a.bankName}</b> · ${a.accountNumber}`,
      `Balance: ${bal} · ${a.transactionCount} txns (${range})`,
      ...this.formatSampleLines(a.samples, a.currency),
      '',
    ];
  }

  private formatSampleLines(
    samples: AccountPreview['samples'], currency: string
  ): string[] {
    return samples.map(s => {
      const desc = s.description.slice(0, 28).padEnd(28);
      return `    ${s.date}  ${desc}  ${this.formatAmount(s.amount, currency)}`;
    });
  }

  private formatBalance(balance: number | undefined, currency: string): string {
    return balance !== undefined ? `${balance.toFixed(2)} ${currency}` : 'N/A';
  }

  private formatAmount(amount: number, currency: string): string {
    return `${amount >= 0 ? '+' : ''}${amount.toFixed(2)} ${currency}`;
  }

  private static computeDateRange(txns: BankTransaction[]): { from: string; to: string } {
    const dates = txns.map(t => new Date(t.date).getTime()).filter(d => !isNaN(d));
    if (dates.length === 0) return { from: 'N/A', to: 'N/A' };
    const toDate = (ts: number): string => formatDate(new Date(ts));
    const [min, max] = dates.reduce(
      ([lo, hi], d) => [Math.min(lo, d), Math.max(hi, d)], [dates[0], dates[0]]
    );
    return { from: toDate(min), to: toDate(max) };
  }

  private static parseSample(
    tx: BankTransaction
  ): { date: string; description: string; amount: number } {
    const date = formatDate(tx.date);
    return { date, description: tx.description ?? tx.memo ?? '', amount: tx.chargedAmount ?? 0 };
  }
}
