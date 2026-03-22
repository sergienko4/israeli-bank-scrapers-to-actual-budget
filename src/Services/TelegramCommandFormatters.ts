/**
 * Formatting helpers for TelegramCommandHandler.
 * Extracted to keep the handler under the 300-line limit.
 */

import { getScraperErrorAdvice } from '../Errors/ScraperErrorMessages.js';
import type { IBatchResult } from '../Types/Index.js';
import type { IAuditEntry, IAuditLog } from './AuditLogService.js';

const DEFAULT_LOG_COUNT = 50;
const MAX_TELEGRAM_LENGTH = 4096;

/**
 * Checks whether an audit entry was recorded during or after a batch.
 * @param entry - The audit log entry to check.
 * @param batch - The IBatchResult whose timing to compare against.
 * @returns True if the entry timestamp is at or after the batch start.
 */
export function isFreshEntry(
  entry: IAuditEntry,
  batch: IBatchResult
): boolean {
  const batchStartMs = Date.now() - batch.totalDurationMs;
  return new Date(entry.timestamp).getTime() >= batchStartMs;
}

/**
 * Builds annotation lines for a bank error.
 * @param advice - Optional actionable advice from ScraperErrorMessages.
 * @param streak - Number of consecutive failures for this bank.
 * @returns Array of annotation lines to append after the error line.
 */
export function buildErrorAnnotations(
  advice: string,
  streak: number
): string[] {
  const lines: string[] = [];
  if (advice) lines.push(`  💡 ${advice}`);
  if (streak >= 5) {
    lines.push('  🚨 Failed 5+ times in a row — check credentials');
  } else if (streak >= 3) {
    lines.push(`  ⚠️ Failed ${String(streak)} times in a row`);
  }
  return lines;
}

/**
 * Formats a single failed bank entry with error details and advice.
 * @param bank - The bank object from the audit entry.
 * @param auditLog - Audit log for looking up failure streak.
 * @returns Formatted bullet-point string with error and advice.
 */
export function formatBankError(
  bank: IAuditEntry['banks'][number],
  auditLog?: IAuditLog
): string {
  const errorSuffix = bank.error ? `: ${bank.error.slice(0, 80)}` : '';
  const line = `• ${bank.name}${errorSuffix}`;
  const advice = bank.error ? getScraperErrorAdvice(bank.error) : '';
  const streakResult = auditLog?.getConsecutiveFailures(bank.name);
  const streak = streakResult?.success ? streakResult.data : 0;
  return [line, ...buildErrorAnnotations(advice, streak)].join('\n');
}

/**
 * Formats the failed-banks section of an error reply.
 * @param entry - The audit entry containing bank failure details.
 * @param dur - Human-readable duration string for display.
 * @param auditLog - Audit log for looking up failure streaks.
 * @returns Multi-line formatted string listing failed banks.
 */
export function formatFailedBanks(
  entry: IAuditEntry,
  dur: string,
  auditLog?: IAuditLog
): string {
  if (entry.failedBanks === 0) {
    return `❌ Import failed (${dur}s). Use /logs for details.`;
  }
  const failed = entry.banks.filter(b => b.status === 'failure');
  const header = `❌ Import failed (${dur}s) — ` +
    `${String(entry.failedBanks)}/${String(entry.totalBanks)} banks had errors:`;
  const lines = [header, ...failed.map(b => formatBankError(b, auditLog))];
  lines.push('', 'Use /logs for details or /status for history.');
  return lines.join('\n');
}

/**
 * Formats a single audit log entry as a one-line status summary.
 * @param entry - The IAuditEntry to format.
 * @returns Formatted string with date, transaction count, and banks.
 */
export function formatAuditEntry(entry: IAuditEntry): string {
  const date = entry.timestamp.split('T')[0];
  const time = entry.timestamp.split('T')[1]?.slice(0, 5) || '';
  const dur = `${(entry.totalDuration / 1000).toFixed(0)}s`;
  const icon = entry.failedBanks === 0 ? '✅' : '⚠️';
  return (
    `${icon} ${date} ${time} — ` +
    `${String(entry.totalTransactions)} txns, ` +
    `${String(entry.successfulBanks)}/${String(entry.totalBanks)} banks, ${dur}`
  );
}

/**
 * Returns a human-readable string describing how long ago a date was.
 * @param date - The Date to compare against the current time.
 * @returns Duration string like "45s", "5m", or "2h".
 */
export function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes)}m`;
  }
  const hours = Math.floor(seconds / 3600);
  return `${String(hours)}h`;
}

/**
 * Parses an optional count argument string to a bounded integer.
 * @param arg - Optional string argument from the user.
 * @returns Integer count between 1 and 150, defaulting to 50.
 */
export function parseLogCount(arg?: string): number {
  if (!arg) return DEFAULT_LOG_COUNT;
  const n = Number.parseInt(arg, 10);
  if (Number.isNaN(n)) return DEFAULT_LOG_COUNT;
  const clampedMin = Math.max(n, 1);
  return Math.min(clampedMin, 150);
}

/**
 * Truncates a list of log entries to fit within Telegram's limit.
 * @param entries - Array of log line strings to truncate.
 * @param reservedLength - Characters used by header/footer wrappers.
 * @returns Truncated log string with an omission notice if needed.
 */
export function truncateForTelegram(
  entries: string[],
  reservedLength: number
): string {
  const maxLength = MAX_TELEGRAM_LENGTH - reservedLength - 20;
  const text = entries.join('\n');
  if (text.length <= maxLength) return text;
  const trimmed = text.slice(-maxLength);
  const firstNewline = trimmed.indexOf('\n');
  const clean = firstNewline > 0 ? trimmed.slice(firstNewline + 1) : trimmed;
  return `...(earlier entries omitted)\n${clean}`;
}
