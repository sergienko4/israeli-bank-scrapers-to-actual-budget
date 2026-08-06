/**
 * ReplyBuilders — pure string builders for Telegram replies.
 * Every function returns a new string or array; none mutate inputs.
 */

import type { IBatchResult } from '../../Types/Index.js';
import type { IAuditEntry } from '../AuditLogService.js';
import {
  formatAuditEntry,
  timeSince,
} from '../TelegramCommandFormatters.js';

export type { IBatchErrorReplyArgs } from './BatchFailureReply.js';
export { buildBatchErrorReply } from './BatchFailureReply.js';

/** Inputs for {@link buildStatusLines}. */
export interface IStatusLinesArgs {
  /** Timestamp of the most recent run, or null when no runs have occurred. */
  readonly lastTime: Date | null;
  /** Most recent batch result, or null when none. */
  readonly lastResult: IBatchResult | null;
  /** Whether an import is currently in progress. */
  readonly isImporting: boolean;
}

/** Static base help lines shared between /help and /start replies. */
const HELP_LINES_BASE: readonly string[] = Object.freeze([
  '🤖 <b>Available Commands</b>', '',
  '/scan - Run bank import now',
  '/retry - Re-import only last failed banks',
  '/preview - Dry run: scrape without importing',
  '/status - Show last run info + history',
  '/check_config - Check configuration (offline + online)',
  '/watch - Spending watch info (runs after each import)',
  '/logs - Show recent log entries',
  '/logs 100 - Show last 100 entries (max 150)',
  '/help - Show this message',
]);

/**
 * Builds the list of help lines for /help and /start.
 * @param hasReceiptHandler - Whether /import_receipt should appear.
 * @returns Frozen array of help message lines.
 */
export function buildHelpLines(
  hasReceiptHandler: boolean,
): readonly string[] {
  if (!hasReceiptHandler) return HELP_LINES_BASE;
  const merged = [...HELP_LINES_BASE];
  merged.splice(-2, 0, '/import_receipt - Import from receipt photo');
  return Object.freeze(merged);
}

/**
 * Builds the /status header lines (without the recent-history block).
 * @param args - Last run time, last result, and current importing flag.
 * @returns Frozen array of status header lines.
 */
export function buildStatusLines(
  args: IStatusLinesArgs,
): readonly string[] {
  const runLine = buildRunLine(args);
  const currentLine = `Currently: ${args.isImporting ? '⏳ importing...' : '✅ idle'}`;
  return Object.freeze(['📊 <b>Status</b>', '', runLine, currentLine]);
}

/**
 * Builds the "Last run" status line (or the no-runs fallback).
 * @param args - Status-line inputs (reads lastTime + lastResult).
 * @returns The formatted run line.
 */
function buildRunLine(args: IStatusLinesArgs): string {
  if (!args.lastTime) return 'No imports run yet';
  const label = args.lastResult ? ` (${resultLabel(args.lastResult)})` : '';
  return `Last run: ${timeSince(args.lastTime)} ago${label}`;
}

/**
 * Labels a batch outcome, distinguishing a partial run from a total failure.
 * @param result - The batch result to label.
 * @returns 'success', 'failed', or a partial label with the OK ratio.
 */
function resultLabel(result: IBatchResult): string {
  if (result.failureCount === 0) return 'success';
  if (result.successCount === 0) return 'failed';
  const total = result.successCount + result.failureCount;
  return `partial: ${String(result.successCount)}/${String(total)} OK`;
}

/**
 * Builds the recent-history block for /status from the supplied entries.
 * Does NOT mutate `entries` — returns a new frozen array (empty when none).
 * @param entries - Most-recent audit entries (newest last, as returned by AuditQuery).
 * @returns Frozen array of history lines, or an empty array when no entries.
 */
export function buildHistoryLines(
  entries: readonly IAuditEntry[],
): readonly string[] {
  if (entries.length === 0) return Object.freeze<string[]>([]);
  const reversed = [...entries].reverse();
  const formatted = reversed.map(e => formatAuditEntry(e));
  return Object.freeze(['', '<b>Recent imports:</b>', ...formatted]);
}

/**
 * Builds the /logs header for a given entry count.
 * @param count - Number of log entries about to be sent.
 * @returns Header string (includes opening <pre>).
 */
export function buildLogsHeader(count: number): string {
  return `📋 <b>Recent Logs</b> (${String(count)} entries)\n\n<pre>`;
}

/**
 * Builds the /logs trailing footer.
 * @returns Footer string (closing </pre>).
 */
export function buildLogsFooter(): string {
  return '</pre>';
}
