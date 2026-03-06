/**
 * Date formatting utilities
 */
import { logger } from './UtilLogger.js';

// Israel is the only supported timezone — all bank transactions are in Jerusalem local time.
// Scrapers produce UTC ISO strings (e.g. "2026-02-14T22:00:00.000Z" = Feb 15 midnight Jerusalem).
// Using Intl.DateTimeFormat with explicit timezone avoids any server-TZ dependency.
const IL_TIMEZONE = 'Asia/Jerusalem';

/**
 * Format a Date or ISO date string as YYYY-MM-DD in Jerusalem (Israel) local time.
 * @param date - A Date object or ISO date string to format.
 * @returns A YYYY-MM-DD string in the Jerusalem timezone.
 */
export function formatDate(date: Date | string): string {
  logger.debug('formatDate');
  return new Intl.DateTimeFormat('en-CA', { timeZone: IL_TIMEZONE }).format(new Date(date));
}

/**
 * Filter transactions to only those whose date (Jerusalem time) is on or after cutoff.
 * Works with both Date objects and ISO/date strings.
 * @param transactions - Array of objects with a `date` field to filter.
 * @param cutoff - YYYY-MM-DD string — any transaction before this date is dropped.
 * @returns Filtered array containing only transactions on or after the cutoff.
 */
export function filterByDateCutoff<T extends { date: Date | string }>(
  transactions: T[], cutoff: string
): T[] {
  logger.debug('filterByDateCutoff');
  return transactions.filter(txn => formatDate(txn.date) >= cutoff);
}
