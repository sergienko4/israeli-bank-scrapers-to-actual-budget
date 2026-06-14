/**
 * Compact "A" format style for Telegram import summary messages.
 * Renders per-transaction lines with date, description, and amount.
 */
import type { IAccountMetrics, IBankMetrics, IImportSummary } from '../../MetricsService.js';
import {
  bankIcon, buildBalanceLines, buildBankFooter, buildHeader,
  escapeHtml, fmtAmount, fmtDate, getTransactions,
} from './Shared.js';
import type { IAccountCtx, IFormatOpts } from './Types.js';

/**
 * Builds the per-transaction display lines for one account in compact style.
 * @param account - The account whose transactions to format.
 * @param opts - Transaction display options.
 * @returns Array of compact transaction lines.
 */
function buildCompactTxnLines(account: IAccountMetrics, opts: IFormatOpts): string[] {
  const lines: string[] = [];
  for (const txn of getTransactions(account, opts)) {
    lines.push(`${fmtDate(txn.date)}  ${escapeHtml(txn.description)}`,
      `       <b>${fmtAmount(txn.amount)}</b>`);
  }
  return lines;
}

/**
 * Builds compact-format lines for one account.
 * @param ctx - Combined bank, account, and format options context.
 * @returns Array of compact-format lines.
 */
export function buildCompactLines(ctx: IAccountCtx): string[] {
  const { bank, account, opts } = ctx;
  const bankLine = `${bankIcon(bank)} <b>${escapeHtml(bank.bankName)}</b>` +
    ` · ${escapeHtml(account.accountName ?? account.accountNumber)}`;
  const lines = ['', bankLine, ...buildCompactTxnLines(account, opts)];
  lines.push(...buildBalanceLines(account, bank));
  return lines;
}

/**
 * Collects compact lines for all accounts in one bank including footer.
 * @param bank - The bank whose accounts to format.
 * @param opts - Transaction display options.
 * @returns Array of compact lines for the entire bank.
 */
function buildCompactBankLines(bank: IBankMetrics, opts: IFormatOpts): string[] {
  const lines: string[] = [];
  for (const account of bank.accounts) {
    lines.push(...buildCompactLines({ bank, account, opts }));
  }
  lines.push(...buildBankFooter(bank));
  return lines;
}

/**
 * Formats the summary in compact "A" style (per-transaction lines).
 * @param summary - The ImportSummary to format.
 * @param opts - Transaction display options.
 * @returns HTML compact string.
 */
export function formatCompact(summary: IImportSummary, opts: IFormatOpts): string {
  const dur = (summary.totalDuration / 1000).toFixed(1);
  const lines: string[] = [
    buildHeader(summary),
    `${String(summary.successfulBanks)}/${String(summary.totalBanks)} banks | ` +
      `${String(summary.totalTransactions)} txns | ${dur}s`,
  ];
  for (const bank of summary.banks) lines.push(...buildCompactBankLines(bank, opts));
  return lines.join('\n');
}
