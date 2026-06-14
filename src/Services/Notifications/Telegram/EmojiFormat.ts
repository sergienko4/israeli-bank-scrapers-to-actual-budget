/**
 * Emoji "C" format style for Telegram import summary messages.
 * Renders transactions with directional icons (📥/📤) per debit/credit.
 */
import type { IAccountMetrics, IBankMetrics, IImportSummary } from '../../MetricsService.js';
import {
  buildBankFooter, buildHeader, buildReconciliationLines,
  escapeHtml, fmtAmount, getTransactions,
} from './Shared.js';
import type { IAccountCtx, IFormatOpts } from './Types.js';

/**
 * Builds emoji transaction lines for one account.
 * @param account - The account whose transactions to format.
 * @param opts - Transaction display options.
 * @returns Array of emoji transaction lines.
 */
function buildEmojiTxnLines(account: IAccountMetrics, opts: IFormatOpts): string[] {
  const lines: string[] = [];
  for (const txn of getTransactions(account, opts)) {
    const dir = txn.amount >= 0 ? '📥' : '📤';
    lines.push(`${dir} <b>${fmtAmount(txn.amount)}</b>  ${escapeHtml(txn.description)}`);
  }
  return lines;
}

/**
 * Builds the balance line for an account in emoji format.
 * @param account - The account whose balance to display.
 * @returns Array of balance lines (empty if no balance available).
 */
function buildEmojiBalanceLine(account: IAccountMetrics): string[] {
  if (account.balance !== undefined) {
    return [`💰 ${account.balance.toLocaleString()} ${account.currency || 'ILS'}`];
  }
  return [];
}

/**
 * Builds emoji-format lines for one account.
 * @param ctx - Combined bank, account, and format options context.
 * @returns Array of emoji-format lines.
 */
export function buildEmojiLines(ctx: IAccountCtx): string[] {
  const { bank, account, opts } = ctx;
  const header = `💳 <b>${escapeHtml(bank.bankName)}</b>` +
    ` · ${escapeHtml(account.accountName ?? account.accountNumber)}`;
  const lines = ['', header, ...buildEmojiTxnLines(account, opts)];
  lines.push(...buildEmojiBalanceLine(account));
  lines.push(...buildReconciliationLines(bank));
  return lines;
}

/**
 * Collects emoji lines for all accounts in one bank including footer.
 * @param bank - The bank whose accounts to format.
 * @param opts - Transaction display options.
 * @returns Array of emoji lines for the entire bank.
 */
function buildEmojiBankLines(bank: IBankMetrics, opts: IFormatOpts): string[] {
  const lines: string[] = [];
  for (const account of bank.accounts) {
    lines.push(...buildEmojiLines({ bank, account, opts }));
  }
  lines.push(...buildBankFooter(bank));
  return lines;
}

/**
 * Formats the summary in emoji "C" style (directional icons per transaction).
 * @param summary - The ImportSummary to format.
 * @param opts - Transaction display options.
 * @returns HTML emoji string.
 */
export function formatEmoji(summary: IImportSummary, opts: IFormatOpts): string {
  const dur = (summary.totalDuration / 1000).toFixed(1);
  const dup = summary.totalDuplicates > 0 ? ` · ${String(summary.totalDuplicates)} dup` : '';
  const statsLine = `📊 ${String(summary.successfulBanks)}/${String(summary.totalBanks)} banks · ` +
    `${String(summary.totalTransactions)} txns${dup} · ${dur}s`;
  const lines = [buildHeader(summary), '', statsLine];
  for (const bank of summary.banks) lines.push(...buildEmojiBankLines(bank, opts));
  return lines.join('\n');
}
