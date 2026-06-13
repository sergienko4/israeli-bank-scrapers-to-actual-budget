/**
 * OcrParsing — pure text-parsing helpers for receipt OCR output.
 * Extracted from ReceiptOcrService to honor SRP + max-fn-lines:10.
 * Owns Israeli-receipt regex patterns and field-extraction logic.
 *
 * Every function body stays <= 10 effective LoC under skipBlankLines
 * + skipComments (enforced by ESLint Section 7k for `src/Services/Receipt/**`).
 */

import { getLogger } from '../../Logger/Index.js';
import type { IReceiptData, Procedure } from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';

/** Regex patterns for Israeli receipt parsing. */
const DATE_PATTERN = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/;
/** Matches Hebrew "total" variants (סה"כ, סה"ג OCR misread). */
const TOTAL_HEB = 'סה.{1,2}[כגך]';
/** Hebrew "to pay" / "total due" patterns. */
const PAY_HEB = String.raw`לתשלום|יתרה\s*לתשלום|שולם|נותר\s*לתשלום`;

const AMOUNT_PATTERNS = [
  // לתשלום (to pay) — highest priority (final total)
  new RegExp(String.raw`(\d[\d,]*(?:\.\d+)?)[\s[\]]*=?(?:${PAY_HEB})`),
  new RegExp(String.raw`(?:${PAY_HEB})[:?\s]*₪?(\d[\d,]*(?:\.\d+)?)`),
  // סה"כ (subtotal/total) — second priority
  new RegExp(String.raw`(\d[\d,]*(?:\.\d+)?)[\s[\]]*(?:${TOTAL_HEB}|total|סכום)`, 'i'),
  new RegExp(String.raw`(?:${TOTAL_HEB}|total|סכום|amount)[:?\s]*₪?(\d[\d,]*(?:\.\d+)?)`, 'i'),
  // Currency symbol patterns
  /₪\s*(\d[\d,]*(?:\.\d+)?)/,
  /(\d{1,3}(?:,\d{3})*\.\d{2})\s*(?:₪|ILS|ש"ח)/,
];

/** Lines to skip when extracting merchant name. */
const SKIP_LINE_PATTERNS = [
  /^\d{7,}/, // business reg number (7+ digits)
  /חשבונית/, // "invoice"
  /קבלה\s*מס/, // "receipt number"
  /העתק/, // "copy"
  /עוסק\s*(מורשה|פטור)/, // "authorized/exempt dealer"
  /ע[.\s]*מ[.\s]|ח[.\s]*פ[.\s]/, // entity abbreviations
  /מספר[:\s]*\d/, // "number: NNN"
  /תאריך/, // "date" header line
  /טלפו?ן/, // "phone"
  /פקס/, // "fax"
  /כתובת/, // "address" label
  /לכבוד/, // "to:" salutation
  /^[-–—\s*]+$/, // separator lines
  /^\s*\d+\s*$/, // lines with only digits
  /^\d{2,3}[-\s]?\d{7}$/, // phone numbers (050-1234567)
];

/** Lines longer than this are skipped (ReDoS safety + noise filter). */
const MAX_LINE_LEN = 200;
/** Global regex for the fallback "largest amount" scan. */
const LARGEST_AMOUNT_PATTERN = /(\d{1,3}(?:,\d{3})*\.\d{2})/g;
const MEMO_MAX_LINES = 5;
const MEMO_MAX_CHARS = 200;
const MERCHANT_MIN_LEN = 3;
const TO_LABEL = 'לכבוד';
const TO_LABEL_PATTERN = /לכבוד\s*[;:]/;
const TO_LABEL_BLOCKLIST = /מספר|טלפון|כתובת|דף|מתוך/;
const INVISIBLE_CHARS = /[\u200F\u200E]/g;
const ALL_INVISIBLE_CHARS = /[\u200F\u200E\u202A-\u202E]/g;

/**
 * Parses OCR text to extract receipt transaction fields.
 * @param text - Raw OCR text from a receipt image.
 * @returns Procedure with extracted IReceiptData fields.
 */
export default function parseReceipt(text: string): Procedure<IReceiptData> {
  const cleaned = text.replaceAll(ALL_INVISIBLE_CHARS, '');
  const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return fail('No text lines to parse');
  const fields = extractAllFields(cleaned, lines);
  logParsed(fields);
  return succeed(fields);
}

/**
 * Builds an IReceiptData by running every extractor against the input.
 * Skipped extractors return `false`; we omit the corresponding field
 * (preserving the `IReceiptData` optional-field contract).
 * @param cleaned - Whole-text OCR output (invisible chars stripped).
 * @param lines - Same text split into trimmed, non-empty lines.
 * @returns Partial IReceiptData with `memo` always present.
 */
function extractAllFields(cleaned: string, lines: string[]): IReceiptData {
  const data: IReceiptData = { memo: buildMemo(lines) };
  const date = extractDate(cleaned);
  const amount = extractAmount(cleaned);
  const merchant = extractMerchant(lines);
  if (date !== false) data.date = date;
  if (amount !== false) data.amount = amount;
  if (merchant !== false) data.merchant = merchant;
  return data;
}

/**
 * Emits a debug log line summarizing parsed fields.
 * @param fields - The IReceiptData returned by extractAllFields.
 * @returns true when the log line was emitted (always — keeps the
 *   signature non-void per project architecture rule).
 */
function logParsed(fields: IReceiptData): boolean {
  const dStr = fields.date ?? 'N/A';
  const aStr = String(fields.amount ?? 'N/A');
  const mStr = fields.merchant ?? 'N/A';
  getLogger().debug(`Receipt parsed: date=${dStr}, amount=${aStr}, merchant=${mStr}`);
  return true;
}

/**
 * Extracts a date from receipt text using common date patterns.
 * @param text - Raw OCR text to search.
 * @returns Formatted YYYY-MM-DD date string or `false` if not found.
 */
function extractDate(text: string): string | false {
  const match = DATE_PATTERN.exec(text);
  if (!match) return false;
  const dayNum = Number.parseInt(match[1], 10);
  const monthNum = Number.parseInt(match[2], 10);
  if (!isValidDayMonth(dayNum, monthNum)) return false;
  return formatDate(dayNum, monthNum, match[3]);
}

/**
 * Validates day-of-month + month-of-year boundaries.
 * @param day - Day (1-31).
 * @param month - Month (1-12).
 * @returns true when both values are inside the calendar window.
 */
function isValidDayMonth(day: number, month: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/**
 * Formats a numeric day / month plus a raw year fragment as YYYY-MM-DD.
 * @param day - Day-of-month integer.
 * @param month - Month-of-year integer.
 * @param rawYear - 2-digit or 4-digit year string from the OCR match.
 * @returns The ISO-style YYYY-MM-DD date string.
 */
function formatDate(day: number, month: number, rawYear: string): string {
  const dayPart = String(day).padStart(2, '0');
  const monthPart = String(month).padStart(2, '0');
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  return `${year}-${monthPart}-${dayPart}`;
}

/**
 * Extracts the total amount, searching line-by-line with priority.
 * Checks לתשלום first across all lines, then סה"כ, then ₪. Falls back
 * to the largest comma-formatted number when no labeled amount matches.
 * @param text - Raw OCR text containing one or more candidate amounts.
 * @returns The chosen amount or `false` when no amount was found.
 */
function extractAmount(text: string): number | false {
  const lines = text.split('\n');
  const labeled = tryAmountPatterns(lines);
  if (labeled !== false) return labeled;
  return findLargestAmount(lines);
}

/**
 * Tries every priority-ordered AMOUNT_PATTERNS regex against the lines.
 * @param lines - Receipt lines to scan in order.
 * @returns The first labeled amount that matched, or `false`.
 */
function tryAmountPatterns(lines: string[]): number | false {
  for (const pattern of AMOUNT_PATTERNS) {
    const value = firstMatchInLines(pattern, lines);
    if (value !== false) return value;
  }
  return false;
}

/**
 * Finds the first matching amount for one pattern across all lines.
 * @param pattern - The AMOUNT_PATTERNS entry to run.
 * @param lines - Receipt lines to scan in order.
 * @returns The first valid parsed amount, or `false`.
 */
function firstMatchInLines(pattern: RegExp, lines: string[]): number | false {
  for (const line of lines) {
    if (line.length > MAX_LINE_LEN) continue;
    const match = pattern.exec(line);
    if (!match) continue;
    const parsed = parseAmountMatch(match);
    if (parsed !== false) return parsed;
  }
  return false;
}

/**
 * Parses an AMOUNT_PATTERNS regex match's captured group into a number.
 * @param match - The non-null RegExpExecArray to parse.
 * @returns The parsed numeric value (>= 1), or `false` for NaN / sub-1.
 */
function parseAmountMatch(match: RegExpExecArray): number | false {
  const digits = match[1].replaceAll(',', '');
  const parsed = Number.parseFloat(digits);
  if (Number.isNaN(parsed) || parsed < 1) return false;
  return parsed;
}

/**
 * Finds the largest comma-formatted amount across all lines.
 * Used as a fallback when no labeled "total" pattern matched.
 * @param lines - Receipt lines to scan.
 * @returns The largest valid amount, or `false`.
 */
function findLargestAmount(lines: string[]): number | false {
  let largest = 0;
  for (const line of lines) {
    if (line.length > MAX_LINE_LEN) continue;
    const lineMax = scanLineForAmounts(line);
    largest = Math.max(largest, lineMax);
  }
  return largest > 0 ? largest : false;
}

/**
 * Scans a single line for comma-formatted amounts and returns the max.
 * @param line - One receipt line.
 * @returns The largest amount found in the line, or 0 when none.
 */
function scanLineForAmounts(line: string): number {
  let largest = 0;
  for (const match of line.matchAll(LARGEST_AMOUNT_PATTERN)) {
    const digits = match[1].replaceAll(',', '');
    const val = Number.parseFloat(digits);
    if (val > largest) largest = val;
  }
  return largest;
}

/**
 * Extracts the merchant name, preferring "לכבוד:" recipient lines and
 * falling back to the first meaningful non-skip line.
 * @param lines - Receipt lines (non-empty, trimmed).
 * @returns The merchant name, or `false` if none found.
 */
function extractMerchant(lines: string[]): string | false {
  const fromTo = extractFromToLine(lines);
  if (fromTo !== false) return fromTo;
  return findFirstMeaningfulLine(lines);
}

/**
 * Reads a "לכבוד:" recipient line and returns the trimmed name.
 * @param lines - Receipt lines (non-empty, trimmed).
 * @returns The recipient name or `false` when no usable line exists.
 */
function extractFromToLine(lines: string[]): string | false {
  const toLine = lines.find(l => TO_LABEL_PATTERN.test(l));
  if (!toLine) return false;
  const name = parseToLine(toLine);
  if (name.length < MERCHANT_MIN_LEN) return false;
  if (TO_LABEL_BLOCKLIST.test(name)) return false;
  return name;
}

/**
 * Trims the "לכבוד:" prefix and invisible chars from a single line.
 * @param line - The receipt line that contains the "לכבוד" token.
 * @returns The trimmed recipient text.
 */
function parseToLine(line: string): string {
  const idx = line.indexOf(TO_LABEL);
  const afterLabel = line.slice(idx + TO_LABEL.length);
  const stripped = afterLabel.replace(/^[\s;:]*/, '');
  return stripped.replaceAll(INVISIBLE_CHARS, '').trim();
}

/**
 * Finds the first line that is long enough, not a date, and not a
 * boilerplate "skip" line (invoice / address / phone / etc.).
 * @param lines - Receipt lines (non-empty, trimmed).
 * @returns The chosen line cleaned of invisible chars, or `false`.
 */
function findFirstMeaningfulLine(lines: string[]): string | false {
  for (const line of lines) {
    if (line.length < 2) continue;
    if (DATE_PATTERN.test(line)) continue;
    if (isSkipLine(line)) continue;
    return line.replaceAll(INVISIBLE_CHARS, '').trim();
  }
  return false;
}

/**
 * Tests whether a line matches any SKIP_LINE_PATTERNS entry.
 * @param line - The line to test.
 * @returns true when the line should be ignored for merchant lookup.
 */
function isSkipLine(line: string): boolean {
  return SKIP_LINE_PATTERNS.some(p => p.test(line));
}

/**
 * Builds a memo string from the first few lines of the receipt.
 * @param lines - Receipt lines (non-empty, trimmed).
 * @returns A truncated memo string with " | " separators.
 */
function buildMemo(lines: string[]): string {
  const head = lines.slice(0, MEMO_MAX_LINES);
  const joined = head.join(' | ');
  return joined.substring(0, MEMO_MAX_CHARS);
}
