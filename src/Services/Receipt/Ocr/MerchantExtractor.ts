/**
 * MerchantExtractor — identifies the merchant name in Israeli receipt OCR text.
 * Prefers "לכבוד:" recipient lines; falls back to the first meaningful non-skip line.
 */

import {
  DATE_PATTERN,
  INVISIBLE_CHARS,
  MERCHANT_MIN_LEN,
  SKIP_LINE_PATTERNS,
  TO_LABEL,
  TO_LABEL_BLOCKLIST,
  TO_LABEL_PATTERN,
} from './Patterns.js';

/**
 * Extracts the merchant name from trimmed, non-empty receipt lines.
 * Prefers "לכבוד:" recipient lines; falls back to first meaningful non-boilerplate line.
 * @param lines - Trimmed, non-empty receipt lines.
 * @returns The merchant name string, or `false` if none could be identified.
 */
export default function extractMerchant(lines: string[]): string | false {
  const fromTo = extractFromToLine(lines);
  if (fromTo !== false) return fromTo;
  return findFirstMeaningfulLine(lines);
}

/**
 * Reads a "לכבוד:" recipient line and returns the trimmed merchant name.
 * Rejects names shorter than {@link MERCHANT_MIN_LEN} or matching {@link TO_LABEL_BLOCKLIST}.
 * @param lines - Trimmed, non-empty receipt lines.
 * @returns The recipient name, or `false` when no usable "לכבוד:" line exists.
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
 * Strips the "לכבוד:" prefix and invisible bidirectional characters from a line.
 * @param line - The receipt line that contains the {@link TO_LABEL} token.
 * @returns The trimmed recipient text after the label.
 */
function parseToLine(line: string): string {
  const idx = line.indexOf(TO_LABEL);
  const afterLabel = line.slice(idx + TO_LABEL.length);
  const stripped = afterLabel.replace(/^[\s;:]*/, '');
  return stripped.replaceAll(INVISIBLE_CHARS, '').trim();
}

/**
 * Finds the first receipt line that is long enough, not a date, and not boilerplate.
 * Boilerplate detection uses {@link SKIP_LINE_PATTERNS}.
 * @param lines - Trimmed, non-empty receipt lines.
 * @returns The cleaned merchant-candidate line, or `false` when none qualifies.
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
 * Tests whether a line matches any {@link SKIP_LINE_PATTERNS} entry.
 * @param line - The line to test.
 * @returns `true` when the line should be ignored for merchant-name lookup.
 */
function isSkipLine(line: string): boolean {
  return SKIP_LINE_PATTERNS.some(p => p.test(line));
}
