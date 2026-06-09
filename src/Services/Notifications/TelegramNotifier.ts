/**
 * Telegram notification channel — thin orchestrator over
 * {@link TelegramApiClient} (HTTP I/O), {@link TelegramFormatter}
 * (message formatting), {@link TelegramHtml} (truncation + validators),
 * and {@link waitForOtpReply} (OTP polling loop).
 *
 * Split out (PR 5) so each concern is independently testable and so the
 * orchestrator stays ≤ 200 LoC. Public class API is byte-identical to the
 * pre-split version — 5 src consumers and 968-LoC test file are unchanged.
 *
 * Message formats (set via config.messageFormat):
 *   "summary"  (D) - Banks overview, no transaction details
 *   "compact"  (A) - Date + description + amount per transaction
 *   "ledger"   (B) - Monospace table layout
 *   "emoji"    (C) - Emoji indicators for deposits/payments
 */

import type {
  ITelegramConfig, MessageFormat, Procedure, ShowTransactions,
} from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import { errorMessage } from '../../Utils/Index.js';
import type { IImportSummary } from '../MetricsService.js';
import type { INotifier } from './INotifier.js';
import TelegramApiClient, { type InlineKeyboard } from './TelegramApiClient.js';
import { escapeHtml, formatSummaryMessage } from './TelegramFormatter.js';
import {
  buildScanKeyboard, isValidBotCommand, truncateMessage,
} from './TelegramHtml.js';
import waitForOtpReply from './TelegramOtpPoller.js';

const DEFAULT_MAX_TRANSACTIONS = 5;
const MAX_TRANSACTIONS_LIMIT = 25;

/** Telegram notification channel — formats and sends import summaries via the Bot API. */
export default class TelegramNotifier implements INotifier {
  private readonly _client: TelegramApiClient;
  private readonly _format: MessageFormat;
  private readonly _showTransactions: ShowTransactions;
  private readonly _maxTransactions: number;

  /**
   * Creates a TelegramNotifier from the given config.
   *
   * @param config - Telegram bot token, chat ID, message format, and transaction display mode.
   * @param maxTransactions - Override for the max transactions shown per account.
   */
  constructor(config: ITelegramConfig, maxTransactions?: number) {
    this._client = new TelegramApiClient(config.botToken, config.chatId);
    this._format = config.messageFormat || 'summary';
    this._showTransactions = config.showTransactions || 'new';
    const clampedMin = Math.max(maxTransactions ?? DEFAULT_MAX_TRANSACTIONS, 1);
    this._maxTransactions = Math.min(clampedMin, MAX_TRANSACTIONS_LIMIT);
  }

  /**
   * Formats and sends an import summary message to the configured Telegram chat.
   *
   * @param summary - The ImportSummary to format and send.
   */
  public async sendSummary(summary: IImportSummary): Promise<void> {
    const opts = {
      showTransactions: this._showTransactions,
      maxTransactions: this._maxTransactions,
    };
    const formatted = formatSummaryMessage(summary, this._format, opts);
    const safeText = truncateMessage(formatted);
    await this._client.sendHtmlMessage(safeText);
  }

  /**
   * Sends a plain HTML text message to the configured Telegram chat.
   *
   * @param text - The HTML-formatted text to send.
   */
  public async sendMessage(text: string): Promise<void> {
    const safeText = truncateMessage(text);
    await this._client.sendHtmlMessage(safeText);
  }

  /**
   * Sends an error notification with a fixed header to the configured Telegram chat.
   *
   * @param error - The error message string to include.
   */
  public async sendError(error: string): Promise<void> {
    const escaped = escapeHtml(error);
    const body = ['🚨 <b>Import Failed</b>', '', escaped].join('\n');
    const safeText = truncateMessage(body);
    await this._client.sendHtmlMessage(safeText);
  }

  /**
   * Sends an inline keyboard menu with a button per bank and an "All banks" button.
   *
   * @param banks - List of bank names to display as inline keyboard buttons.
   * @returns Procedure indicating the menu was sent or describing the failure.
   */
  public async sendScanMenu(banks: string[]): Promise<Procedure<{ status: string }>> {
    const keyboard = buildScanKeyboard(banks);
    return await this.tryPostMenu('🏦 <b>Select bank to import:</b>', keyboard, 'sendScanMenu');
  }

  /**
   * Sends a prompt and polls for the next non-command reply from the chat.
   *
   * @param prompt - HTML-formatted message to send before waiting.
   * @param timeoutMs - Maximum milliseconds to wait before throwing a timeout error.
   * @returns The text content of the first valid reply message.
   */
  public async waitForReply(prompt: string, timeoutMs: number): Promise<string> {
    return await waitForOtpReply(this._client, prompt, timeoutMs);
  }

  /**
   * Registers the bot's command list with Telegram via setMyCommands.
   *
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
      await this._client.setMyCommands(commands);
      return succeed({ status: 'commands-registered' });
    } catch (error: unknown) {
      return fail(`Failed to register commands: ${errorMessage(error)}`);
    }
  }

  /**
   * Downloads a photo from Telegram by its file_id.
   *
   * @param fileId - The Telegram file_id of the photo to download.
   * @returns Procedure with the image Buffer, or failure.
   */
  public async downloadPhoto(fileId: string): Promise<Procedure<Buffer>> {
    try {
      const filePath = await this._client.getFilePath(fileId);
      if (!filePath) return fail('getFile returned no file_path');
      return await this._client.downloadFile(filePath);
    } catch (error: unknown) {
      return fail(`Photo download error: ${errorMessage(error)}`);
    }
  }

  /**
   * Sends an inline keyboard menu to the configured chat.
   *
   * @param text - HTML message text above the keyboard.
   * @param keyboard - Array of button rows for the inline keyboard.
   * @returns Procedure indicating the menu was sent.
   */
  public async sendInlineMenu(
    text: string, keyboard: InlineKeyboard
  ): Promise<Procedure<{ status: string }>> {
    return await this.tryPostMenu(text, keyboard, 'sendInlineMenu');
  }

  /**
   * Shared retry-wrapper for inline-keyboard menu posts (scan + custom).
   *
   * @param text - HTML message text above the keyboard.
   * @param keyboard - Inline keyboard rows.
   * @param label - Caller label used in failure messages.
   * @returns Procedure indicating menu was sent or describing the failure.
   */
  private async tryPostMenu(
    text: string, keyboard: InlineKeyboard, label: string
  ): Promise<Procedure<{ status: string }>> {
    try {
      await this._client.sendHtmlMessage(text, keyboard);
      return succeed({ status: 'menu-sent' });
    } catch (error: unknown) {
      return fail(`${label} error: ${errorMessage(error)}`);
    }
  }
}
