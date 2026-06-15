/**
 * Default "D" format style for Telegram import summary messages.
 * Renders a bank overview with transaction counts and duration — no transaction details.
 */
import type { IBankMetrics, IImportSummary } from '../../MetricsService.js';
import { bankIcon, buildHeader, buildReconciliationLines, escapeHtml } from './Shared.js';

/**
 * Builds the summary header lines including stats for default format.
 * @param summary - The ImportSummary to format.
 * @param dur - Pre-formatted duration string in seconds.
 * @returns Array of header lines.
 */
function buildDefaultHeaderLines(summary: IImportSummary, dur: string): string[] {
  return [
    buildHeader(summary), '',
    `🏦 Banks: ${String(summary.successfulBanks)}/${String(summary.totalBanks)} ` +
      `(${summary.successRate.toFixed(0)}%)`,
    `📥 Transactions: ${String(summary.totalTransactions)} imported`,
    `🔄 Duplicates: ${String(summary.totalDuplicates)} skipped`,
    `⏱ Duration: ${dur}s`,
  ];
}

/**
 * Builds lines for a single bank in default format.
 * @param bank - The BankMetrics to format.
 * @returns Array of formatted bank lines.
 */
export function buildDefaultBankLines(bank: IBankMetrics): string[] {
  const dur = bank.duration ? `${(bank.duration / 1000).toFixed(1)}s` : '';
  const name = escapeHtml(bank.bankName);
  const txn = `${bankIcon(bank)} ${name}: ${String(bank.transactionsImported)} txns ${dur}`;
  const lines = [txn, ...buildReconciliationLines(bank)];
  if (bank.error) lines.push(`   ❌ ${escapeHtml(bank.error)}`);
  return lines;
}

/**
 * Formats the summary in default "D" style (banks overview, no transaction details).
 * @param summary - The ImportSummary to format.
 * @returns HTML summary string.
 */
export function formatDefault(summary: IImportSummary): string {
  const dur = (summary.totalDuration / 1000).toFixed(1);
  const lines = buildDefaultHeaderLines(summary, dur);
  if (summary.banks.length > 0) {
    lines.push('');
    for (const bank of summary.banks) lines.push(...buildDefaultBankLines(bank));
  }
  return lines.join('\n');
}
