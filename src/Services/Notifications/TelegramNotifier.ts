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

import { NetworkError, TimeoutError } from '../../Errors/ErrorTypes.js';
import type {
ITelegramApiResponse,
  ITelegramConfig,MessageFormat, Procedure,ShowTransactions } from '../../Types/Index.js';
import { fail, isFail, succeed } from '../../Types/Index.js';
import type {
  IImportSummary
} from '../MetricsService.js';
import type { INotifier } from './INotifier.js';
import { escapeHtml,formatSummaryMessage } from './TelegramFormatter.js';

const TELEGRAM_API = 'https://api.telegram.org';
const MAX_MESSAGE_LENGTH = 4096;
const DEFAULT_MAX_TRANSACTIONS = 5;
const MAX_TRANSACTIONS_LIMIT = 25;
const COMMAND_PATTERN = /^[a-z0-9_]{1,32}$/;
const MAX_DESCRIPTION_LENGTH = 256;

/** Poll result from a single getUpdates call. */
interface IPollResult {
  updates: ITelegramApiResponse;
  nextOffset: number;
}

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
export default class TelegramNotifier implements INotifier {
  private readonly _botToken: string;
  private readonly _chatId: string;
  private readonly _format: MessageFormat;
  private readonly _showTransactions: ShowTransactions;
  private readonly _maxTransactions: number;

  /**
   * Creates a TelegramNotifier from the given config.
   * @param config - Telegram bot token, chat ID, message format, and transaction display mode.
   * @param maxTransactions - Override for the max transactions shown per account.
   */
  constructor(config: ITelegramConfig, maxTransactions?: number) {
    this._botToken = config.botToken;
    this._chatId = config.chatId;
    this._format = config.messageFormat || 'summary';
    this._showTransactions = config.showTransactions || 'new';
    const clampedMin = Math.max(maxTransactions ?? DEFAULT_MAX_TRANSACTIONS, 1);
    this._maxTransactions = Math.min(clampedMin, MAX_TRANSACTIONS_LIMIT);
  }

  /**
   * Formats and sends an import summary message to the configured Telegram chat.
   * @param summary - The ImportSummary to format and send.
   */
  public async sendSummary(summary: IImportSummary): Promise<void> {
    const opts = {
      showTransactions: this._showTransactions,
      maxTransactions: this._maxTransactions,
    };
    const formatted = formatSummaryMessage(summary, this._format, opts);
    await this.send(formatted);
  }

  /**
   * Sends a plain HTML text message to the configured Telegram chat.
   * @param text - The HTML-formatted text to send.
   */
  public async sendMessage(text: string): Promise<void> {
    await this.send(text);
  }

  /**
   * Sends an error notification with a fixed header to the configured Telegram chat.
   * @param error - The error message string to include.
   */
  public async sendError(error: string): Promise<void> {
    const escaped = escapeHtml(error);
    const errorMessage = ['🚨 <b>Import Failed</b>', '', escaped].join('\n');
    await this.send(errorMessage);
  }

  /**
   * Sends an inline keyboard menu with a button per bank and an "All banks" button.
   * @param banks - List of bank names to display as inline keyboard buttons.
   */
  public async sendScanMenu(banks: string[]): Promise<void> {
    const allRow = [{ text: '🏦 All banks', callback_data: 'scan_all' }];
    const bankRows: { text: string; callback_data: string }[][] = [];
    for (let idx = 0; idx < banks.length; idx += 2) {
      const slice = banks.slice(idx, idx + 2);
      const row = slice.map(bankName => ({ text: bankName, callback_data: `scan:${bankName}` }));
      bankRows.push(row);
    }
    const url = `${TELEGRAM_API}/bot${this._botToken}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this._chatId,
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
  public async waitForReply(prompt: string, timeoutMs: number): Promise<string> {
    const offset = await this.getLatestOffset();
    await this.send(prompt);
    const sentAt = Math.floor(Date.now() / 1000);
    const deadline = Date.now() + timeoutMs;
    return this.pollForReply(offset, sentAt, deadline);
  }

  /**
   * Registers the bot's command list with Telegram via setMyCommands.
   * @param extras - Additional commands to include beyond the built-in set.
   * @returns Procedure indicating commands were registered.
   */
  public async registerCommands(
    extras: { command: string; description: string }[] = []
  ): Promise<Procedure<{ status: string }>> {
    const commands = [
      { command: 'scan', description: 'Run bank import now' },
      { command: 'status', description: 'Show last run info + history' },
      ...extras.filter(cmd => isValidBotCommand(cmd.command, cmd.description)),
      { command: 'logs', description: 'Show recent log entries' },
      { command: 'help', description: 'List available commands' },
    ];
    try {
      await this.sendBotCommands(commands);
      return succeed({ status: 'commands-registered' });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return fail(`Failed to register commands: ${msg}`);
    }
  }

  /**
   * Downloads a photo from Telegram by its file_id.
   * @param fileId - The Telegram file_id of the photo to download.
   * @returns Procedure with the image Buffer, or failure.
   */
  public async downloadPhoto(
    fileId: string
  ): Promise<Procedure<Buffer>> {
    try {
      const filePath = await this.fetchFilePath(fileId);
      if (!filePath) return fail('getFile returned no file_path');
      return await this.fetchFileContent(filePath);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return fail(`Photo download error: ${msg}`);
    }
  }

  /**
   * Sends an inline keyboard menu to the configured chat.
   * @param text - HTML message text above the keyboard.
   * @param keyboard - Array of button rows for the inline keyboard.
   * @returns Procedure indicating the menu was sent.
   */
  public async sendInlineMenu(
    text: string,
    keyboard: { text: string; callback_data: string }[][]
  ): Promise<Procedure<{ status: string }>> {
    try {
      return await this.postInlineKeyboard(text, keyboard);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return fail(`sendInlineMenu error: ${msg}`);
    }
  }

  // ─── Private ───

  /**
   * Iteratively polls for an OTP reply until the deadline expires.
   * @param offset - Current Telegram update offset.
   * @param sentAt - Unix timestamp of when the prompt was sent.
   * @param deadline - Absolute time in ms after which to throw TimeoutError.
   * @returns The OTP reply text.
   */
  private async pollForReply(offset: number, sentAt: number, deadline: number): Promise<string> {
    let currentOffset = offset;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new TimeoutError('2FA reply wait', 0);
      const iterResult = await this.processOneReplyPoll(currentOffset, sentAt);
      if (isFail(iterResult)) {
        await new Promise<void>(r => { globalThis.setTimeout(r, 2000); });
        continue;
      }
      currentOffset = iterResult.data.nextOffset;
      if (iterResult.data.reply) return iterResult.data.reply;
    }
  }

  /**
   * Polls once for updates and checks for a valid OTP reply.
   * @param offset - Current update offset for getUpdates.
   * @param sentAt - Unix timestamp of when the prompt was sent.
   * @returns Procedure with the next offset and optional reply text.
   */
  private async processOneReplyPoll(
    offset: number, sentAt: number
  ): Promise<Procedure<{ nextOffset: number; reply: string | false }>> {
    const pollResult = await this.pollUpdates(offset);
    if (isFail(pollResult)) return fail('poll failed');
    const reply = this.findReplyMessage(pollResult.data.updates, sentAt);
    const nextOffset = pollResult.data.nextOffset;
    if (isFail(reply)) return succeed({ nextOffset, reply: false as const });
    if (!TelegramNotifier.looksLikeOtp(reply.data)) {
      await this.sendMessage('⚠️ Please send the numeric OTP code from your SMS (4–8 digits).');
      return succeed({ nextOffset, reply: false as const });
    }
    await this.confirmOffset(nextOffset);
    return succeed({ nextOffset, reply: reply.data });
  }

  /**
   * Fetches pending updates from Telegram starting at the given offset.
   * @param offset - The update_id offset to pass to getUpdates.
   * @returns Procedure with updates and the next offset, or failure on HTTP error.
   */
  private async pollUpdates(offset: number): Promise<Procedure<IPollResult>> {
    const url = `${TELEGRAM_API}/bot${this._botToken}` +
      `/getUpdates?offset=${String(offset)}&timeout=5`;
    const response = await fetch(url);
    if (!response.ok) return fail(`getUpdates failed: ${String(response.status)}`);
    const data = await response.json() as ITelegramApiResponse;
    const last = data.result?.at(-1);
    const lastId = last ? last.update_id : offset - 1;
    return succeed({ updates: data, nextOffset: lastId + 1 });
  }

  /**
   * Searches updates for the first non-command reply from the configured chat after the prompt.
   * @param data - The ITelegramApiResponse to search through.
   * @param sentAt - Unix timestamp of when the prompt was sent; earlier messages are skipped.
   * @returns Procedure with the message text, or failure if no valid reply found.
   */
  private findReplyMessage(data: ITelegramApiResponse, sentAt: number): Procedure<string> {
    for (const update of data.result ?? []) {
      const msg = update.message;
      if (!msg?.text || String(msg.chat.id) !== this._chatId) continue;
      if (msg.date < sentAt || msg.text.startsWith('/')) continue;
      return succeed(msg.text);
    }
    return fail('no reply found');
  }

  /**
   * Fetches the latest update_id from Telegram to use as the starting offset.
   * @returns The next offset (latest update_id + 1), or 0 on failure.
   */
  private async getLatestOffset(): Promise<number> {
    const url = `${TELEGRAM_API}/bot${this._botToken}/getUpdates?offset=-1`;
    const response = await fetch(url);
    if (!response.ok) return 0;
    const data = await response.json() as ITelegramApiResponse;
    const lastResult = data.result?.at(-1);
    return lastResult ? lastResult.update_id + 1 : 0;
  }

  /**
   * Confirms all updates up to the given offset with Telegram.
   * Ensures the next getLatestOffset() call returns a clean state.
   * @param offset - The offset to confirm (all updates below this are acknowledged).
   */
  private async confirmOffset(offset: number): Promise<void> {
    try {
      const url = `${TELEGRAM_API}/bot${this._botToken}` +
        `/getUpdates?offset=${String(offset)}&timeout=0`;
      await fetch(url);
    } catch {
      // Non-critical — getLatestOffset() will still work
    }
  }

  /**
   * Returns true when the text contains 4-8 digit characters (typical OTP length).
   * @param text - The Telegram reply text to test.
   * @returns True if the text looks like an OTP code.
   */
  private static looksLikeOtp(text: string): boolean {
    const digits = text.replaceAll(/\D/g, '');
    return digits.length >= 4 && digits.length <= 8;
  }

  /**
   * Sends the command list to Telegram via the setMyCommands API endpoint.
   * @param commands - Array of command+description objects to register.
   */
  private async sendBotCommands(
    commands: { command: string; description: string }[]
  ): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this._botToken}/setMyCommands`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new NetworkError(`setMyCommands failed: ${String(response.status)} ${body}`);
    }
  }

  /**
   * Truncates a message to Telegram's 4096-character limit, closing open HTML tags.
   * @param text - The full message text that may exceed the limit.
   * @returns Safely truncated message with all HTML tags properly closed.
   */
  private static truncateMessage(text: string): string {
    if (text.length <= MAX_MESSAGE_LENGTH) return text;
    const trimmed = text.slice(0, MAX_MESSAGE_LENGTH - 30);
    const cut = TelegramNotifier.trimPartialTag(trimmed);
    const withEllipsis = `${cut}\n\n... (truncated)`;
    return TelegramNotifier.closeUnclosedTags(withEllipsis);
  }

  /**
   * Removes a partially-cut HTML tag from the end of a truncated string.
   * @param text - The truncated string that may end mid-tag.
   * @returns String with any partial opening tag removed.
   */
  private static trimPartialTag(text: string): string {
    const lastOpen = text.lastIndexOf('<');
    const lastClose = text.lastIndexOf('>');
    return lastOpen > lastClose ? text.slice(0, lastOpen) : text;
  }

  /**
   * Appends closing tags for any HTML tags left open in the string.
   * @param text - The potentially truncated HTML string to fix.
   * @returns String with all unclosed HTML tags properly closed.
   */
  private static closeUnclosedTags(text: string): string {
    const openTags: string[] = [];
    const tagRegex = /<(\/?)(\w+)[^>]*>/g;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(text)) !== null) {
      if (match[1] === '/') { if (openTags.length > 0) openTags.pop(); }
      else { openTags.push(match[2]); }
    }
    return text + [...openTags].reverse().map((tag) => `</${tag}>`).join('');
  }

  /**
   * Sends an HTML-parsed message to the configured Telegram chat.
   * @param text - HTML-formatted message text to send (will be truncated if needed).
   */
  private async send(text: string): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this._botToken}/sendMessage`;
    const truncated = TelegramNotifier.truncateMessage(text);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this._chatId, text: truncated, parse_mode: 'HTML'
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new NetworkError(`Telegram API error ${String(response.status)}: ${body}`);
    }
  }

  /**
   * Fetches the file path from Telegram for a given file_id.
   * @param fileId - The Telegram file_id to look up.
   * @returns The file_path string, or false if unavailable.
   */
  private async fetchFilePath(
    fileId: string
  ): Promise<string | false> {
    const fileUrl =
      `${TELEGRAM_API}/bot${this._botToken}/getFile?file_id=${fileId}`;
    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) {
      return false;
    }
    const fileData = await fileResponse.json() as {
      ok: boolean; result?: { file_path: string };
    };
    if (!fileData.ok || !fileData.result?.file_path) return false;
    return fileData.result.file_path;
  }

  /**
   * Downloads the file content from Telegram's file storage.
   * @param filePath - The Telegram file_path to download from.
   * @returns Procedure with the image Buffer, or failure.
   */
  private async fetchFileContent(
    filePath: string
  ): Promise<Procedure<Buffer>> {
    const downloadUrl =
      `${TELEGRAM_API}/file/bot${this._botToken}/${filePath}`;
    const imageResponse = await fetch(downloadUrl);
    if (!imageResponse.ok) {
      return fail(`Photo download failed: ${String(imageResponse.status)}`);
    }
    const arrayBuffer = await imageResponse.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);
    return succeed(imageBuffer);
  }

  /**
   * Posts an inline keyboard message to the Telegram chat.
   * @param text - HTML message text above the keyboard.
   * @param keyboard - Array of button rows for the inline keyboard.
   * @returns Procedure indicating the menu was sent.
   */
  private async postInlineKeyboard(
    text: string,
    keyboard: { text: string; callback_data: string }[][]
  ): Promise<Procedure<{ status: string }>> {
    const url = `${TELEGRAM_API}/bot${this._botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this._chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard },
      }),
    });
    if (!response.ok) {
      return fail(`sendInlineMenu failed: ${String(response.status)}`);
    }
    return succeed({ status: 'menu-sent' });
  }
}
