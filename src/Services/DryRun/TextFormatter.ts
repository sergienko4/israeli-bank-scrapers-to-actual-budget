import { formatDateRange } from './PreviewBuilder.js';
import type { IAccountPreview } from './Types.js';

const TEXT_TITLE = '\n🔍 DRY RUN — no changes made to Actual Budget';
const SEPARATOR = '═'.repeat(50);
type AccountSample = IAccountPreview['samples'][number];
/** Formats previews for CLI.
 * @param accounts previews.
 * @param summary total line.
 * @returns text. */
export function formatText(accounts: IAccountPreview[], summary: string): string {
  const accountLines = accounts.flatMap(account => accountTextLines(account));
  return [TEXT_TITLE, SEPARATOR, ...accountLines, SEPARATOR, summary].join('\n');
}
/** Formats one account for CLI.
 * @param account preview.
 * @returns account lines. */
export function accountTextLines(account: IAccountPreview): string[] {
  const header = accountHeader(account);
  const samples = formatSampleLines(account.samples, account.currency);
  return account.samples.length === 0 ? header : [...header, '  Recent:', ...samples];
}
/** Formats samples.
 * @param samples preview samples.
 * @param currency currency code.
 * @returns lines. */
export function formatSampleLines(samples: AccountSample[], currency: string): string[] {
  return samples.map(sample => sampleTextLine(sample, currency));
}
/** Formats a balance.
 * @param balance account balance.
 * @param currency currency code.
 * @returns text. */
export function formatBalance(balance: IAccountPreview['balance'], currency: string): string {
  return balance === undefined ? 'N/A' : `${balance.toFixed(2)} ${currency}`;
}
/** Formats an amount.
 * @param amount transaction amount.
 * @param currency currency code.
 * @returns text. */
export function formatAmount(amount: number, currency: string): string {
  return `${amount >= 0 ? '+' : ''}${amount.toFixed(2)} ${currency}`;
}
/** Builds account header lines.
 * @param account preview.
 * @returns header lines. */
function accountHeader(account: IAccountPreview): string[] {
  return [
    `\n📊 ${account.bankName}  💳 ${account.accountNumber}`,
    `  Balance: ${formatBalance(account.balance, account.currency)}`,
    `  Transactions: ${String(account.transactionCount)}  (${formatDateRange(account)})`,
  ];
}
/** Builds one sample line.
 * @param sample sample.
 * @param currency currency code.
 * @returns line. */
function sampleTextLine(sample: AccountSample, currency: string): string {
  const description = sample.description.slice(0, 28).padEnd(28);
  const amount = formatAmount(sample.amount, currency);
  return `    ${sample.date}  ${description}  ${amount}`;
}
