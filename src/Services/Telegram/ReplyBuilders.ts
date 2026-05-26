/**
 * ReplyBuilders — pure string builders for Telegram replies.
 * Every function returns a new string or array; none mutate inputs.
 */

import type { IBatchResult } from '../../Types/Index.js';
import type { IAuditEntry, IAuditLog } from '../AuditLogService.js';
import {
  formatAuditEntry,
  formatFailedBanks,
  isFreshEntry,
  timeSince,
} from '../TelegramCommandFormatters.js';

/** Inputs for {@link buildStatusLines}. */
export interface IStatusLinesArgs {
  /** Timestamp of the most recent run, or null when no runs have occurred. */
  readonly lastTime: Date | null;
  /** Most recent batch result, or null when none. */
  readonly lastResult: IBatchResult | null;
  /** Whether an import is currently in progress. */
  readonly isImporting: boolean;
}

/** Inputs for {@link buildBatchErrorReply}. */
export interface IBatchErrorReplyArgs {
  /** The completed batch with failure information. */
  readonly batch: IBatchResult;
  /** Optional fresh audit entry recorded during this batch. */
  readonly entry: IAuditEntry | undefined;
  /** Optional audit log used for failure-streak annotations. */
  readonly auditLog: IAuditLog | undefined;
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
  const resultLabel = args.lastResult?.failureCount === 0 ? 'success' : 'failed';
  const label = args.lastResult ? ` (${resultLabel})` : '';
  const runLine = args.lastTime
    ? `Last run: ${timeSince(args.lastTime)} ago${label}`
    : 'No imports run yet';
  const currentLine = `Currently: ${args.isImporting ? '⏳ importing...' : '✅ idle'}`;
  return Object.freeze(['📊 <b>Status</b>', '', runLine, currentLine]);
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

/**
 * Builds the multi-line error reply for a failed batch.
 * Falls back to a generic single-line message when the audit entry is stale
 * or absent.
 * @param args - Batch, optional fresh audit entry, and audit log.
 * @returns Reply text suitable for sendMessage().
 */
export function buildBatchErrorReply(
  args: IBatchErrorReplyArgs,
): string {
  const dur = (args.batch.totalDurationMs / 1000).toFixed(0);
  const entry = args.entry;
  if (!entry || !isFreshEntry(entry, args.batch)) {
    return `❌ Import failed (${dur}s). Use /logs for details.`;
  }
  return formatFailedBanks(entry, dur, args.auditLog);
}
