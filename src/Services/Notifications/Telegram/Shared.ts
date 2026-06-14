/**
 * Shared helper functions for the Telegram formatter cluster.
 * Provides escaping, icons, headers, balance lines, and date/amount formatting
 * used by every format style (default, compact, ledger, emoji).
 */
import type {
  IAccountMetrics, IBankMetrics, IImportSummary, ITransactionRecord,
} from '../../MetricsService.js';
import type { IFormatOpts } from './Types.js';

/**
 * Escapes HTML special characters to prevent Telegram parse errors.
 * @param text - Raw text that may contain &, <, or > characters.
 * @returns HTML-safe string.
 */
export function escapeHtml(text: string): string {
  // Safe: Telegram HTML mode supports only <b>,<i>,<a>,<code> — no JS execution.
  // This escapes &, <, > to prevent markup injection in bot messages, not web XSS.
  return text // nosemgrep
    .replaceAll('&', '&amp;') // nosemgrep
    .replaceAll('<', '&lt;') // nosemgrep
    .replaceAll('>', '&gt;'); // nosemgrep
}

/**
 * Returns a status icon string for a bank based on its import result.
 * @param bank - The BankMetrics to check.
 * @returns '✅' for success or '❌' for failure.
 */
export function bankIcon(bank: IBankMetrics): string {
  return bank.status === 'success' ? '✅' : '❌';
}

/**
 * Builds the bold header line with a success/warning icon.
 * @param summary - The ImportSummary used to choose the icon.
 * @returns HTML header string.
 */
export function buildHeader(summary: IImportSummary): string {
  return `${summary.failedBanks === 0 ? '✅' : '⚠️'} <b>Import Summary</b>`;
}

/**
 * Builds bank-level footer lines including error when no accounts are reported.
 * @param bank - The BankMetrics whose footer to build.
 * @returns Array of footer lines to append.
 */
export function buildBankFooter(bank: IBankMetrics): string[] {
  const lines: string[] = [];
  if (bank.accounts.length === 0) {
    lines.push('', `${bankIcon(bank)} <b>${escapeHtml(bank.bankName)}</b>`);
  }
  if (bank.error) lines.push(`❌ ${escapeHtml(bank.error)}`);
  return lines;
}

/**
 * Builds a reconciliation status line when one exists.
 * @param bank - The bank whose reconciliation status to check.
 * @returns Array of reconciliation lines (empty if no reconciliation info).
 */
export function buildReconciliationLines(bank: IBankMetrics): string[] {
  if (bank.reconciliationStatus === 'created' && bank.reconciliationAmount !== undefined) {
    const sign = bank.reconciliationAmount > 0 ? '+' : '';
    return [`🔄 Reconciled: ${sign}${(bank.reconciliationAmount / 100).toFixed(2)} ILS`];
  }
  if (bank.reconciliationStatus === 'skipped') return ['✅ Balance matched'];
  if (bank.reconciliationStatus === 'already-reconciled') return ['✅ Already reconciled'];
  return [];
}

/**
 * Builds balance and reconciliation lines for an account.
 * @param account - The account whose balance to display.
 * @param bank - The bank whose reconciliation status to display.
 * @returns Array of balance and reconciliation lines.
 */
export function buildBalanceLines(account: IAccountMetrics, bank: IBankMetrics): string[] {
  const lines: string[] = [];
  if (account.balance !== undefined) {
    lines.push(`💰 ${account.balance.toLocaleString()} ${account.currency || 'ILS'}`);
  }
  lines.push(...buildReconciliationLines(bank));
  return lines;
}

/**
 * Returns the transactions to display for an account based on display options.
 * @param account - The account whose transactions to retrieve.
 * @param opts - Transaction display options (showTransactions, maxTransactions).
 * @returns Sliced array of ITransactionRecord objects.
 */
export function getTransactions(account: IAccountMetrics, opts: IFormatOpts): ITransactionRecord[] {
  if (opts.showTransactions === 'none') return [];
  const txns = opts.showTransactions === 'all'
    ? [...account.newTransactions, ...account.existingTransactions]
    : account.newTransactions;
  return txns.slice(0, opts.maxTransactions);
}

/**
 * Formats a cent amount as a signed decimal string.
 * @param cents - The amount in cents to format.
 * @returns Signed decimal string with 2 decimal places.
 */
export function fmtAmount(cents: number): string {
  return `${cents >= 0 ? '+' : ''}${(cents / 100).toFixed(2)}`;
}

/**
 * Formats a YYYY-MM-DD date string to DD/MM for compact display.
 * @param date - YYYY-MM-DD formatted date string.
 * @returns Two-part date string like "15/03".
 */
export function fmtDate(date: string): string {
  const parts = date.split('-');
  return `${parts[2]}/${parts[1]}`;
}
