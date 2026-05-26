/**
 * CommandCallbackParser — pure parsing helpers for Telegram commands.
 * Replicates the original `handle()` prelude: split on whitespace, lowercase
 * the leading token, but preserve the payload after a colon prefix verbatim.
 *
 * All string returns use the empty-string sentinel ('') to mean "no value".
 * This avoids `string | undefined` return types (forbidden by ESLint).
 */

/** Result of parsing one raw Telegram command/callback string. */
export interface IParsedCommand {
  /** The first token lowercased (or colon-prefix lowercased for `scan:`/`receipt_*:`). */
  readonly command: string;
  /** Whitespace remainder, joined and trimmed. Empty string when absent. */
  readonly arg: string;
  /** The original trimmed input. */
  readonly raw: string;
}

/**
 * Parses a raw Telegram message text or callback_data string.
 * Same behaviour as the existing handle() prelude (split, lowercase, colon-aware).
 * @param raw - Raw text from Telegram.
 * @returns IParsedCommand describing command, arg, and trimmed raw.
 */
export function parseCommand(raw: string): IParsedCommand {
  const trimmed = raw.trim();
  const tokens = trimmed.split(/\s+/);
  const firstToken = tokens[0] ?? '';
  const command = lowercaseLeadingToken(firstToken);
  const arg = tokens.slice(1).join(' ').trim();
  return { command, arg, raw: trimmed };
}

/**
 * Lowercases the leading command token. When the token contains a colon
 * (e.g. `scan:Discount` or `receipt_acc:abc-123`), only the prefix up to and
 * including the colon is lowercased; the payload after the colon is preserved.
 * @param token - The first whitespace-trimmed token.
 * @returns The (possibly partially) lowercased token.
 */
function lowercaseLeadingToken(token: string): string {
  const colonIdx = token.indexOf(':');
  if (colonIdx < 0) return token.toLowerCase();
  const prefix = token.slice(0, colonIdx + 1).toLowerCase();
  const payload = token.slice(colonIdx + 1);
  return `${prefix}${payload}`;
}

/**
 * Extracts the payload after a known prefix.
 * `extractPrefixPayload('scan:cal', 'scan:')` -> 'cal'.
 * @param raw - The full command string.
 * @param prefix - The literal prefix to strip.
 * @returns The trimmed payload, or '' when prefix not present or payload empty.
 */
export function extractPrefixPayload(raw: string, prefix: string): string {
  if (!raw.startsWith(prefix)) return '';
  return raw.slice(prefix.length).trim();
}
