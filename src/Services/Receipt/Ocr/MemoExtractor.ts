/**
 * MemoExtractor — builds a short memo string from the first lines of a receipt.
 * The memo is used as a transaction note in the downstream budget import.
 */

import { MEMO_MAX_CHARS, MEMO_MAX_LINES } from './Patterns.js';

/**
 * Builds a truncated memo string from the first {@link MEMO_MAX_LINES} receipt lines.
 * Lines are joined with " | " and the result is capped at {@link MEMO_MAX_CHARS} characters.
 * @param lines - Trimmed, non-empty receipt lines.
 * @returns A " | "-joined, character-capped memo string.
 */
export default function buildMemo(lines: string[]): string {
  const head = lines.slice(0, MEMO_MAX_LINES);
  const joined = head.join(' | ');
  return joined.substring(0, MEMO_MAX_CHARS);
}
