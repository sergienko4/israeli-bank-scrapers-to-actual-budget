/**
 * DryRunCollector — collects and formats account preview data in dry-run mode
 * No writes to Actual Budget; shows what WOULD be imported.
 */

import type { IBankTransaction } from '../Types/Index.js';
import { formatDate } from '../Utils/Index.js';

/** Preview data for a single scraped account in dry-run mode. */
export interface IAccountPreview {
  bankName: string;
  accountNumber: string;
  balance: number | undefined;
  currency: string;
  transactionCount: number;
  dateRange: { from: string; to: string };
  samples: { date: string; description: string; amount: number }[];
}

/** Input to {@link DryRunCollector.buildPreview} — raw data from a scraped account. */
export interface IPreviewInput {
  bankName: string;
  accountNumber: string;
  balance: number | undefined;
  currency: string;
  txns: IBankTransaction[];
}

/**
 * Collects and formats account preview data when `DRY_RUN=true`.
 *
 * No data is written to Actual Budget — this service only reads scraped results
 * and formats them for CLI and Telegram output.
 */
export class DryRunCollector {
  private readonly _accounts: IAccountPreview[] = [];

  /**
   * Adds an account preview to the collected list.
   * @param preview - The IAccountPreview to record.
   */
  public recordAccount(preview: IAccountPreview): void {
    this._accounts.push(preview);
  }

  /**
   * Returns all collected account previews.
   * @returns Array of IAccountPreview objects.
   */
  public getPreview(): IAccountPreview[] { return this._accounts; }

  /**
   * Returns true when at least one account has been recorded.
   * @returns True if any accounts have been collected.
   */
  public hasAccounts(): boolean { return this._accounts.length > 0; }

  /**
   * Sums the transaction count across all collected accounts.
   * @returns Total number of transactions across all previewed accounts.
   */
  public totalTransactions(): number {
    return this._accounts.reduce((sum, a) => sum + a.transactionCount, 0);
  }

  /**
   * Formats the collected previews as a plain-text CLI summary.
   * @returns Multi-line text string with account details and a summary line.
   */
  public formatText(): string {
    const lines = ['\n🔍 DRY RUN — no changes made to Actual Budget', '═'.repeat(50)];
    for (const a of this._accounts) lines.push(...DryRunCollector.accountTextLines(a));
    const footerSeparator = '═'.repeat(50);
    const summary = this.summaryLine();
    lines.push(footerSeparator, summary);
    return lines.join('\n');
  }

  /**
   * Formats the collected previews as an HTML-annotated Telegram message.
   * @returns Multi-line HTML string suitable for Telegram sendMessage.
   */
  public formatTelegram(): string {
    const lines = ['🔍 <b>Dry Run Preview</b> — no changes made', ''];
    for (const a of this._accounts) lines.push(...DryRunCollector.accountTelegramLines(a));
    const summary = this.summaryLine();
    lines.push(summary);
    return lines.join('\n');
  }

  /**
   * Constructs an IAccountPreview from raw scraped account data.
   * @param input - Raw account data including bank name, number, balance, and transactions.
   * @returns A new IAccountPreview with computed date range and sample transactions.
   */
  public static buildPreview(input: IPreviewInput): IAccountPreview {
    const { bankName, accountNumber, balance, currency, txns } = input;
    return {
      bankName, accountNumber, balance, currency,
      transactionCount: txns.length,
      dateRange: DryRunCollector.computeDateRange(txns),
      samples: txns.slice(0, 3).map(tx => DryRunCollector.parseSample(tx)),
    };
  }

  // ─── Private helpers ───

  /**
   * Generates a single summary line with account and transaction counts.
   * @returns Summary string like "Total: 2 accounts, 15 transactions (0 imported — dry run)".
   */
  private summaryLine(): string {
    const n = this._accounts.length;
    const t = this.totalTransactions();
    return `Total: ${String(n)} account${n === 1 ? '' : 's'}, ` +
      `${String(t)} transaction${t === 1 ? '' : 's'} (0 imported — dry run)`;
  }

  /**
   * Formats a single account preview as plain-text lines for CLI output.
   * @param a - The IAccountPreview to format.
   * @returns Array of text lines for this account.
   */
  private static accountTextLines(a: IAccountPreview): string[] {
    const header = [
      `\n📊 ${a.bankName}  💳 ${a.accountNumber}`,
      `  Balance: ${DryRunCollector.formatBalance(a.balance, a.currency)}`,
      `  Transactions: ${String(a.transactionCount)}  (${a.dateRange.from} → ${a.dateRange.to})`,
    ];
    if (a.samples.length === 0) return header;
    return [...header, '  Recent:', ...DryRunCollector.formatSampleLines(a.samples, a.currency)];
  }

  /**
   * Formats a single account preview as HTML-annotated Telegram lines.
   * @param a - The IAccountPreview to format.
   * @returns Array of HTML-formatted lines for this account.
   */
  private static accountTelegramLines(a: IAccountPreview): string[] {
    const bal = DryRunCollector.formatBalance(a.balance, a.currency);
    const range = `${a.dateRange.from} → ${a.dateRange.to}`;
    return [
      `💳 <b>${a.bankName}</b> · ${a.accountNumber}`,
      `Balance: ${bal} · ${String(a.transactionCount)} txns (${range})`,
      ...DryRunCollector.formatSampleLines(a.samples, a.currency),
      '',
    ];
  }

  /**
   * Formats an array of sample transactions as indented display lines.
   * @param samples - Up to 3 sample transactions to display.
   * @param currency - Currency code appended to each amount.
   * @returns Array of formatted transaction lines.
   */
  private static formatSampleLines(
    samples: IAccountPreview['samples'], currency: string
  ): string[] {
    return samples.map(s => {
      const desc = s.description.slice(0, 28).padEnd(28);
      return `    ${s.date}  ${desc}  ${DryRunCollector.formatAmount(s.amount, currency)}`;
    });
  }

  /**
   * Formats a balance number with currency, returning 'N/A' when undefined.
   * @param balance - Optional numeric balance value.
   * @param currency - Currency code to append.
   * @returns Formatted balance string like "1234.56 ILS" or "N/A".
   */
  private static formatBalance(balance: number | undefined, currency: string): string {
    return balance === undefined ? 'N/A' : `${balance.toFixed(2)} ${currency}`;
  }

  /**
   * Formats a transaction amount with sign prefix and currency code.
   * @param amount - The numeric amount (positive = credit, negative = debit).
   * @param currency - Currency code to append.
   * @returns Formatted amount string like "+120.00 ILS" or "-50.00 ILS".
   */
  private static formatAmount(amount: number, currency: string): string {
    return `${amount >= 0 ? '+' : ''}${amount.toFixed(2)} ${currency}`;
  }

  /**
   * Computes the earliest and latest transaction dates in a list.
   * @param txns - Array of IBankTransaction objects to inspect.
   * @returns Object with from and to YYYY-MM-DD strings, or 'N/A' when empty.
   */
  private static computeDateRange(txns: IBankTransaction[]): { from: string; to: string } {
    const dates = txns.map(t => new Date(t.date).getTime()).filter(d => !Number.isNaN(d));
    if (dates.length === 0) return { from: 'N/A', to: 'N/A' };
    /**
     * Converts a Unix timestamp to a YYYY-MM-DD date string.
     * @param ts - Unix timestamp in milliseconds.
     * @returns YYYY-MM-DD date string.
     */
    const toDate = (ts: number): string => formatDate(new Date(ts));
    const [min, max] = dates.reduce(
      ([lo, hi], d) => [Math.min(lo, d), Math.max(hi, d)], [dates[0], dates[0]]
    );
    return { from: toDate(min), to: toDate(max) };
  }

  /**
   * Extracts a compact sample record from a IBankTransaction for preview display.
   * @param tx - The IBankTransaction to extract from.
   * @returns Object with formatted date, description, and charged amount.
   */
  private static parseSample(
    tx: IBankTransaction
  ): { date: string; description: string; amount: number } {
    const date = formatDate(tx.date);
    return { date, description: tx.description ?? tx.memo ?? '', amount: tx.chargedAmount ?? 0 };
  }
}
