/**
 * Telegram notification channel using native fetch() (Node.js 22+)
 * Zero external dependencies - uses Telegram Bot API directly
 *
 * Message formats (set via config.messageFormat):
 *   "summary"  (D) - Banks overview, no transaction details
 *   "compact"  (A) - Date + description + amount per transaction
 *   "ledger"   (B) - Monospace table layout
 *   "emoji"    (C) - Emoji indicators for deposits/payments
 */

import type {
  TelegramConfig, MessageFormat, ShowTransactions, TelegramApiResponse
} from '../../Types/Index.js';
import type {
  ImportSummary
} from '../MetricsService.js';
import type { INotifier } from './INotifier.js';
import { formatSummaryMessage, escapeHtml } from './TelegramFormatter.js';

const TELEGRAM_API = 'https://api.telegram.org';
const MAX_MESSAGE_LENGTH = 4096;
const DEFAULT_MAX_TRANSACTIONS = 5;
const MAX_TRANSACTIONS_LIMIT = 25;
const COMMAND_PATTERN = /^[a-z0-9_]{1,32}$/;
const MAX_DESCRIPTION_LENGTH = 256;

/**
 * Validates a bot command name and description against Telegram Bot API limits.
 * @param command - The command string (1-32 lowercase alphanumeric/underscore characters).
 * @param description - The command description (1-256 characters).
 * @returns True if both the command and description meet Telegram's requirements.
 */
function isValidBotCommand(command: string, description: string): boolean {
  return COMMAND_PATTERN.test(command)
    && description.length >= 1
    && description.length <= MAX_DESCRIPTION_LENGTH;
}

/** Telegram notification channel — formats and sends import summaries via the Bot API. */
export class TelegramNotifier implements INotifier {
  private botToken: string;
  private chatId: string;
  private format: MessageFormat;
  private showTransactions: ShowTransactions;
  private maxTransactions: number;

  /**
   * Creates a TelegramNotifier from the given config.
   * @param config - Telegram bot token, chat ID, message format, and transaction display mode.
   * @param maxTransactions - Override for the max transactions shown per account.
   */
  constructor(config: TelegramConfig, maxTransactions?: number) {
    this.botToken = config.botToken;
    this.chatId = config.chatId;
    this.format = config.messageFormat || 'summary';
    this.showTransactions = config.showTransactions || 'new';
    this.maxTransactions = Math.min(
      Math.max(maxTransactions ?? DEFAULT_MAX_TRANSACTIONS, 1),
      MAX_TRANSACTIONS_LIMIT
    );
  }

  /**
   * Formats and sends an import summary message to the configured Telegram chat.
   * @param summary - The ImportSummary to format and send.
   */
  async sendSummary(summary: ImportSummary): Promise<void> {
    const opts = { showTransactions: this.showTransactions, maxTransactions: this.maxTransactions };
    await this.send(formatSummaryMessage(summary, this.format, opts));
  }

  /**
   * Sends a plain HTML text message to the configured Telegram chat.
   * @param text - The HTML-formatted text to send.
   */
  async sendMessage(text: string): Promise<void> {
    await this.send(text);
  }

  /**
   * Sends an error notification with a fixed header to the configured Telegram chat.
   * @param error - The error message string to include.
   */
  async sendError(error: string): Promise<void> {
    await this.send(['🚨 <b>Import Failed</b>', '', escapeHtml(error)].join('\n'));
  }

  /**
   * Sends an inline keyboard menu with a button per bank and an "All banks" button.
   * @param banks - List of bank names to display as inline keyboard buttons.
   */
  async sendScanMenu(banks: string[]): Promise<void> {
    const allRow = [{ text: '🏦 All banks', callback_data: 'scan_all' }];
    const bankRows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let i = 0; i < banks.length; i += 2) {
      bankRows.push(banks.slice(i, i + 2).map(b => ({ text: b, callback_data: `scan:${b}` })));
    }
    const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: '🏦 <b>Select bank to import:</b>',
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [allRow, ...bankRows] },
      }),
    });
  }

  /**
   * Sends a prompt and polls for the next non-command reply from the chat.
   * @param prompt - HTML-formatted message to send before waiting.
   * @param timeoutMs - Maximum milliseconds to wait before throwing a timeout error.
   * @returns The text content of the first valid reply message.
   */
  async waitForReply(prompt: string, timeoutMs: number): Promise<string> {
    let offset = await this.getLatestOffset();
    await this.send(prompt);
    const sentAt = Math.floor(Date.now() / 1000);
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const result = await this.pollUpdates(offset);
      if (!result) continue;
      const reply = this.findReplyMessage(result.updates, sentAt);
      offset = result.nextOffset;
      if (!reply) continue;
      if (!this.looksLikeOtp(reply)) {
        await this.sendMessage('⚠️ Please send the numeric OTP code from your SMS (4–8 digits).');
        continue;
      }
      return reply;
    }
    throw new Error('2FA timeout: no reply received');
  }

  /**
   * Registers the bot's command list with Telegram via setMyCommands.
   * @param extras - Additional commands to include beyond the built-in set.
   */
  async registerCommands(
    extras: Array<{ command: string; description: string }> = []
  ): Promise<void> {
    const commands = [
      { command: 'scan', description: 'Run bank import now' },
      { command: 'status', description: 'Show last run info + history' },
      ...extras.filter(c => isValidBotCommand(c.command, c.description)),
      { command: 'logs', description: 'Show recent log entries' },
      { command: 'help', description: 'List available commands' },
    ];
    await this.sendBotCommands(commands);
  }

  /**
   * Fetches pending updates from Telegram starting at the given offset.
   * @param offset - The update_id offset to pass to getUpdates.
   * @returns Object with updates and the next offset, or null on HTTP failure.
   */
  private async pollUpdates(
    offset: number
  ): Promise<{ updates: TelegramApiResponse; nextOffset: number } | null> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates?offset=${offset}&timeout=5`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json() as TelegramApiResponse;
    const lastId = data.result?.length
      ? data.result[data.result.length - 1].update_id
      : offset - 1;
    return { updates: data, nextOffset: lastId + 1 };
  }

  /**
   * Searches updates for the first non-command reply from the configured chat after the prompt.
   * @param data - The TelegramApiResponse to search through.
   * @param sentAt - Unix timestamp of when the prompt was sent; earlier messages are skipped.
   * @returns The message text of the first valid reply, or null if none found.
   */
  private findReplyMessage(data: TelegramApiResponse, sentAt: number): string | null {
    for (const update of data.result ?? []) {
      const msg = update.message;
      if (!msg?.text || String(msg.chat.id) !== this.chatId) continue;
      if (msg.date < sentAt || msg.text.startsWith('/')) continue;
      return msg.text;
    }
    return null;
  }

  /**
   * Fetches the latest update_id from Telegram to use as the starting offset.
   * @returns The next offset (latest update_id + 1), or 0 on failure.
   */
  private async getLatestOffset(): Promise<number> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates?offset=-1`;
    const response = await fetch(url);
    if (!response.ok) return 0;
    const data = await response.json() as TelegramApiResponse;
    return data.result?.length ? data.result[data.result.length - 1].update_id + 1 : 0;
  }

  /**
   * Returns true when the text contains 4-8 digit characters (typical OTP length).
   * @param text - The Telegram reply text to test.
   * @returns True if the text looks like an OTP code.
   */
  private looksLikeOtp(text: string): boolean {
    const digits = text.replace(/\D/g, '');
    return digits.length >= 4 && digits.length <= 8;
  }

  /**
   * Sends the command list to Telegram via the setMyCommands API endpoint.
   * @param commands - Array of command+description objects to register.
   */
  private async sendBotCommands(
    commands: Array<{ command: string; description: string }>
  ): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/setMyCommands`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`setMyCommands failed: ${response.status} ${body}`);
    }
  }

  /**
   * Truncates a message to Telegram's 4096-character limit, closing open HTML tags.
   * @param text - The full message text that may exceed the limit.
   * @returns Safely truncated message with all HTML tags properly closed.
   */
  private truncateMessage(text: string): string {
    if (text.length <= MAX_MESSAGE_LENGTH) return text;
    const cut = this.trimPartialTag(text.slice(0, MAX_MESSAGE_LENGTH - 30));
    return this.closeUnclosedTags(cut + '\n\n... (truncated)');
  }

  /**
   * Removes a partially-cut HTML tag from the end of a truncated string.
   * @param text - The truncated string that may end mid-tag.
   * @returns String with any partial opening tag removed.
   */
  private trimPartialTag(text: string): string {
    const lastOpen = text.lastIndexOf('<');
    const lastClose = text.lastIndexOf('>');
    return lastOpen > lastClose ? text.slice(0, lastOpen) : text;
  }

  /**
   * Appends closing tags for any HTML tags left open in the string.
   * @param text - The potentially truncated HTML string to fix.
   * @returns String with all unclosed HTML tags properly closed.
   */
  private closeUnclosedTags(text: string): string {
    const openTags: string[] = [];
    const tagRegex = /<(\/?)(\w+)[^>]*>/g;
    let match;
    while ((match = tagRegex.exec(text)) !== null) {
      if (match[1] === '/') { if (openTags.length > 0) openTags.pop(); }
      else { openTags.push(match[2]); }
    }
    return text + openTags.reverse().map(t => `</${t}>`).join('');
  }

  /**
   * Sends an HTML-parsed message to the configured Telegram chat.
   * @param text - HTML-formatted message text to send (will be truncated if needed).
   */
  private async send(text: string): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId, text: this.truncateMessage(text), parse_mode: 'HTML'
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API error ${response.status}: ${body}`);
    }
  }
}
