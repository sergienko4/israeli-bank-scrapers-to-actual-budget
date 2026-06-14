import { formatBalance, formatSampleLines } from './TextFormatter.js';
import type { IAccountPreview } from './Types.js';

const TELEGRAM_TITLE = '🔍 <b>Dry Run Preview</b> — no changes made';
/** Formats previews for Telegram.
 * @param accounts previews.
 * @param summary total line.
 * @returns text. */
export function formatTelegram(accounts: IAccountPreview[], summary: string): string {
  const accountLines = accounts.flatMap(account => accountTelegramLines(account));
  return [TELEGRAM_TITLE, '', ...accountLines, summary].join('\n');
}
/** Formats one account for Telegram.
 * @param account preview.
 * @returns account lines. */
export function accountTelegramLines(account: IAccountPreview): string[] {
  const balance = formatBalance(account.balance, account.currency);
  const count = String(account.transactionCount);
  return [
    `💳 <b>${account.bankName}</b> · ${account.accountNumber}`,
    `Balance: ${balance} · ${count} txns (${dateRangeText(account)})`,
    ...formatSampleLines(account.samples, account.currency),
    '',
  ];
}
/** Builds a date-range label.
 * @param account preview.
 * @returns date-range text. */
function dateRangeText(account: IAccountPreview): string {
  return `${account.dateRange.from} → ${account.dateRange.to}`;
}