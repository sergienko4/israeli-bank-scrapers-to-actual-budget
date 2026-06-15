/**
 * AmountExtractor — locates the total transaction amount in Israeli receipt OCR text.
 * Searches line-by-line using priority-ordered patterns, falling back to the largest
 * comma-formatted number when no labeled "total" line is found.
 *
 * ReDoS safety: every line loop skips lines longer than {@link MAX_LINE_LEN}.
 */

import { AMOUNT_PATTERNS, LARGEST_AMOUNT_PATTERN, MAX_LINE_LEN } from './Patterns.js';

/**
 * Extracts the total transaction amount from raw OCR receipt text.
 * Tries labeled patterns (לתשלום, סה"כ, ₪) first; falls back to the
 * largest comma-formatted number when none match.
 * @param text - Raw OCR text containing one or more candidate amounts.
 * @returns The chosen numeric amount, or `false` when no amount is found.
 */
export default function extractAmount(text: string): number | false {
  const lines = text.split('\n');
  const labeled = tryAmountPatterns(lines);
  if (labeled !== false) return labeled;
  return findLargestAmount(lines);
}

/**
 * Tries every priority-ordered {@link AMOUNT_PATTERNS} regex against all lines.
 * @param lines - Receipt lines to scan in pattern-priority order.
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
 * Finds the first valid amount match for one pattern across all receipt lines.
 * Lines longer than {@link MAX_LINE_LEN} are skipped (ReDoS safety).
 * @param pattern - One {@link AMOUNT_PATTERNS} entry to run.
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
 * Parses the captured group from an {@link AMOUNT_PATTERNS} match into a number.
 * @param match - The non-null {@link RegExpExecArray} to parse.
 * @returns The parsed numeric value (≥ 1), or `false` for NaN or sub-1 values.
 */
function parseAmountMatch(match: RegExpExecArray): number | false {
  const digits = match[1].replaceAll(',', '');
  const parsed = Number.parseFloat(digits);
  if (Number.isNaN(parsed) || parsed < 1) return false;
  return parsed;
}

/**
 * Finds the largest comma-formatted amount across all receipt lines.
 * Used as a fallback when no labeled "total" pattern matched.
 * Lines longer than {@link MAX_LINE_LEN} are skipped (ReDoS safety).
 * @param lines - Receipt lines to scan.
 * @returns The largest valid amount found, or `false`.
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
 * Scans one receipt line for all comma-formatted amounts and returns the maximum.
 * @param line - One receipt line to scan with {@link LARGEST_AMOUNT_PATTERN}.
 * @returns The largest amount found in the line, or `0` when none match.
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
