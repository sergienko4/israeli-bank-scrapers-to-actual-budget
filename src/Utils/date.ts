/**
 * Date formatting utilities
 */

// Israel is the only supported timezone — all bank transactions are in Jerusalem local time.
// Scrapers produce UTC ISO strings (e.g. "2026-02-14T22:00:00.000Z" = Feb 15 midnight Jerusalem).
// Using Intl.DateTimeFormat with explicit timezone avoids any server-TZ dependency.
const IL_TIMEZONE = 'Asia/Jerusalem';

/** Format a Date or ISO date string as YYYY-MM-DD in Jerusalem (Israel) local time */
export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IL_TIMEZONE }).format(new Date(date));
}
