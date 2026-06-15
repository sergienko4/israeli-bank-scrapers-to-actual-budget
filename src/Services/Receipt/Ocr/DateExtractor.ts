/**
 * DateExtractor — extracts and validates ISO dates from Israeli receipt OCR text.
 * Uses a Date round-trip to reject impossible calendar dates (e.g., 31/02).
 */

import { DATE_PATTERN } from './Patterns.js';

/**
 * Extracts a calendar-validated date from raw OCR receipt text.
 * Rejects dates that fail a `Date` round-trip (31/02, 29/02 in non-leap years, etc.).
 * @param text - Raw OCR text to search for a date string.
 * @returns Formatted YYYY-MM-DD date string, or `false` when no valid date is found.
 */
export default function extractDate(text: string): string | false {
  const match = DATE_PATTERN.exec(text);
  if (!match) return false;
  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const year = normalizeYear(match[3]);
  if (year === false) return false;
  if (!isValidCalendarDate(day, month, year)) return false;
  return formatDate(day, month, year);
}

/**
 * Normalises a 2-digit or 4-digit OCR year fragment into a 4-digit year number.
 * Returns `false` for any unexpected length so callers cannot coerce OCR misreads.
 * @param rawYear - Year string captured by {@link DATE_PATTERN} (2 or 4 digits).
 * @returns 4-digit year as a number, or `false` for unexpected lengths.
 */
function normalizeYear(rawYear: string): number | false {
  if (rawYear.length === 2) return Number.parseInt(`20${rawYear}`, 10);
  if (rawYear.length === 4) return Number.parseInt(rawYear, 10);
  return false;
}

/**
 * Validates a full year/month/day tuple via a `Date` round-trip.
 * Rejects impossible calendar dates that pass naïve range-only validation.
 * @param day - Day-of-month integer.
 * @param month - Month-of-year integer (1–12).
 * @param year - 4-digit year integer.
 * @returns `true` when the tuple represents an actual calendar date.
 */
function isValidCalendarDate(day: number, month: number, year: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const c = new Date(year, month - 1, day);
  return c.getFullYear() === year && c.getMonth() === month - 1 && c.getDate() === day;
}

/**
 * Formats a numeric day/month/year tuple as a YYYY-MM-DD ISO date string.
 * @param day - Day-of-month integer.
 * @param month - Month-of-year integer.
 * @param year - 4-digit year integer.
 * @returns The ISO-style YYYY-MM-DD date string.
 */
function formatDate(day: number, month: number, year: number): string {
  const dayPart = String(day).padStart(2, '0');
  const monthPart = String(month).padStart(2, '0');
  return `${String(year)}-${monthPart}-${dayPart}`;
}
