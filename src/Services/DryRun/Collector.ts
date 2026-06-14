import { buildPreview } from './PreviewBuilder.js';
import { formatTelegram } from './TelegramFormatter.js';
import { formatText } from './TextFormatter.js';
import type { IAccountPreview, IPreviewInput } from './Types.js';

/** Collects dry-run account previews without writing to Actual Budget. */
export default class DryRunCollector {
  private readonly _accounts: IAccountPreview[] = [];

  /** Adds one account preview.
   * @param preview account preview to record. */
  public recordAccount(preview: IAccountPreview): void { this._accounts.push(preview); }

  /** Returns all recorded previews.
   * @returns collected account previews. */
  public getPreview(): IAccountPreview[] { return this._accounts; }

  /** Reports whether any preview exists.
   * @returns true when at least one account is recorded. */
  public hasAccounts(): boolean { return this._accounts.length > 0; }

  /** Sums collected transaction counts.
   * @returns total transaction count. */
  public totalTransactions(): number {
    return this._accounts.reduce((sum, account) => sumTransactions(sum, account), 0);
  }

  /** Formats previews for CLI output.
   * @returns multi-line dry-run text summary. */
  public formatText(): string { return formatText(this._accounts, this.summaryLine); }

  /** Formats previews for Telegram output.
   * @returns multi-line Telegram HTML summary. */
  public formatTelegram(): string { return formatTelegram(this._accounts, this.summaryLine); }

  /** Builds one account preview.
   * @param input scraped account payload.
   * @returns normalized preview. */
  public static buildPreview(input: IPreviewInput): IAccountPreview { return buildPreview(input); }

  /** Builds the aggregate summary line.
   * @returns total account and transaction summary. */
  private get summaryLine(): string {
    const accounts = this._accounts.length;
    const transactions = this.totalTransactions();
    return `Total: ${String(accounts)} account${accounts === 1 ? '' : 's'}, ` +
      `${String(transactions)} transaction${transactions === 1 ? '' : 's'} (0 imported — dry run)`;
  }
}

/** Adds one account transaction count.
 * @param sum current total.
 * @param account preview.
 * @returns next total. */
function sumTransactions(sum: number, account: IAccountPreview): number {
  return sum + account.transactionCount;
}
