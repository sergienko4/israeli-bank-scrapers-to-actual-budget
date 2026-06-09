/**
 * TelegramHtml — pure HTML/text utilities for the Telegram channel.
 *
 * Extracted from {@link TelegramNotifier} (PR 5) so HTML truncation,
 * unclosed-tag handling, and small validators are testable in isolation.
 * No I/O, no class state — every export is a pure function.
 */

import type { InlineKeyboard } from './TelegramApiClient.js';

const MAX_MESSAGE_LENGTH = 4096;
const TRUNCATE_RESERVE = 30;
const MAX_DESCRIPTION_LENGTH = 256;
const COMMAND_PATTERN = /^[a-z0-9_]{1,32}$/;
const OTP_MIN_DIGITS = 4;
const OTP_MAX_DIGITS = 8;

/**
 * Truncates an HTML message to Telegram's 4096-character limit,
 * closing any tags left open by the cut.
 *
 * @param text - The HTML-formatted message body.
 * @returns Message of length ≤ 4096 with all tags balanced.
 */
export function truncateMessage(text: string): string {
  if (text.length <= MAX_MESSAGE_LENGTH) return text;
  const trimmed = text.slice(0, MAX_MESSAGE_LENGTH - TRUNCATE_RESERVE);
  const cut = trimPartialTag(trimmed);
  const withEllipsis = `${cut}\n\n... (truncated)`;
  return closeUnclosedTags(withEllipsis);
}

/**
 * Removes a partially-cut HTML tag from the end of a truncated string.
 *
 * @param text - The truncated string that may end mid-tag.
 * @returns String with any partial opening tag removed.
 */
export function trimPartialTag(text: string): string {
  const lastOpen = text.lastIndexOf('<');
  const lastClose = text.lastIndexOf('>');
  return lastOpen > lastClose ? text.slice(0, lastOpen) : text;
}

/**
 * Appends closing tags for any HTML tags left open in the string.
 *
 * @param text - The potentially truncated HTML string to fix.
 * @returns String with all unclosed HTML tags properly closed.
 */
export function closeUnclosedTags(text: string): string {
  const openTags: string[] = [];
  const tagRegex = /<(\/?)(\w+)\b[^>]*>/g;
  for (const match of text.matchAll(tagRegex)) {
    if (match[1] === '/') {
      if (openTags.length > 0) openTags.pop();
    } else {
      openTags.push(match[2]);
    }
  }
  return text + [...openTags].reverse().map((tag) => `</${tag}>`).join('');
}

/**
 * Returns true when the text contains 4-8 digit characters (typical OTP length).
 *
 * @param text - The Telegram reply text to test.
 * @returns True if the text looks like an OTP code.
 */
export function looksLikeOtp(text: string): boolean {
  const digits = text.replaceAll(/\D/g, '');
  return digits.length >= OTP_MIN_DIGITS && digits.length <= OTP_MAX_DIGITS;
}

/**
 * Validates a bot command and description against Telegram Bot API limits.
 *
 * @param command - The command (1-32 lowercase alphanumeric/underscore characters).
 * @param description - The command description (1-256 characters).
 * @returns True if both fields meet Telegram's requirements.
 */
export function isValidBotCommand(command: string, description: string): boolean {
  return COMMAND_PATTERN.test(command)
    && description.length >= 1
    && description.length <= MAX_DESCRIPTION_LENGTH;
}

/**
 * Builds inline-keyboard rows for the /scan bank picker.
 *
 * Layout: a leading "All banks" row followed by rows of up to two bank buttons.
 *
 * @param banks - Bank names to render as buttons.
 * @returns Keyboard rows ready for Telegram's reply_markup.
 */
export function buildScanKeyboard(banks: string[]): InlineKeyboard {
  const allRow = [{ text: '🏦 All banks', callback_data: 'scan_all' }];
  const bankRows: InlineKeyboard = [];
  for (let idx = 0; idx < banks.length; idx += 2) {
    const slice = banks.slice(idx, idx + 2);
    const row = slice.map(bankName => ({ text: bankName, callback_data: `scan:${bankName}` }));
    bankRows.push(row);
  }
  return [allRow, ...bankRows];
}
