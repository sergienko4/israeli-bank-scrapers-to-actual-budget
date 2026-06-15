/**
 * Ledger "B" format style for Telegram import summary messages.
 * Renders transactions in a monospace code-block table layout.
 */
import type { IBankMetrics, IImportSummary, ITransactionRecord } from '../../MetricsService.js';
import {
  bankIcon, buildBalanceLines, buildBankFooter, buildHeader,
  escapeHtml, fmtAmount, fmtDate, getTransactions,
} from './Shared.js';
import type { IAccountCtx, IFormatOpts } from './Types.js';

/**
 * Builds monospace transaction rows inside a code block.
 * @param txns - Transactions to render in table format.
 * @returns Array of ledger transaction lines including code tags.
 */
export function buildLedgerTransactionLines(txns: ITransactionRecord[]): string[] {
  const lines: string[] = ['<code>'];
  for (const txn of txns) {
    const raw = txn.description.length > 18 ? `${txn.description.slice(0, 18)}..` : txn.description;
    lines.push(`${fmtDate(txn.date)} ${escapeHtml(raw)}`,
      `${''.padStart(6)}${fmtAmount(txn.amount).padStart(9)}`);
  }
  lines.push('</code>');
  return lines;
}

/**
 * Builds ledger-format lines for one account.
 * @param ctx - Combined bank, account, and format options context.
 * @returns Array of ledger-format lines.
 */
export function buildLedgerLines(ctx: IAccountCtx): string[] {
  const { bank, account, opts } = ctx;
  const bankLine = `${bankIcon(bank)} <b>${escapeHtml(bank.bankName)}</b>` +
    ` · ${escapeHtml(account.accountName ?? account.accountNumber)}`;
  const txns = getTransactions(account, opts);
  const txnLines = txns.length > 0 ? buildLedgerTransactionLines(txns) : [];
  return ['', bankLine, ...txnLines, ...buildBalanceLines(account, bank)];
}

/**
 * Collects ledger lines for all accounts in one bank including footer.
 * @param bank - The bank whose accounts to format.
 * @param opts - Transaction display options.
 * @returns Array of ledger lines for the entire bank.
 */
function buildLedgerBankLines(bank: IBankMetrics, opts: IFormatOpts): string[] {
  const lines: string[] = [];
  for (const account of bank.accounts) {
    lines.push(...buildLedgerLines({ bank, account, opts }));
  }
  lines.push(...buildBankFooter(bank));
  return lines;
}

/**
 * Formats the summary in ledger "B" style (monospace table).
 * @param summary - The ImportSummary to format.
 * @param opts - Transaction display options.
 * @returns HTML ledger string.
 */
export function formatLedger(summary: IImportSummary, opts: IFormatOpts): string {
  const dur = (summary.totalDuration / 1000).toFixed(1);
  const lines: string[] = [
    buildHeader(summary), `${String(summary.totalTransactions)} transactions · ${dur}s`,
  ];
  for (const bank of summary.banks) lines.push(...buildLedgerBankLines(bank, opts));
  return lines.join('\n');
}
