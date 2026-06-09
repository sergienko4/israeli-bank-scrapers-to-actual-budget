/**
 * TelegramApiClient — thin wrapper over Telegram Bot API HTTP endpoints.
 *
 * Owns ALL fetch() I/O for the Telegram channel. Holds `botToken` + `chatId`
 * as immutable construction state. Extracted from {@link TelegramNotifier}
 * (PR 5) to keep the notifier as a thin orchestrator that wires
 * formatting (TelegramFormatter) and HTML safety (TelegramHtml) with API
 * I/O (this module).
 *
 * Every method either resolves with the parsed result OR throws
 * {@link NetworkError}. No business logic, no formatting, no truncation.
 */

import { NetworkError } from '../../Errors/ErrorTypes.js';
import { fail, type ITelegramApiResponse, type Procedure,succeed } from '../../Types/Index.js';

const TELEGRAM_API = 'https://api.telegram.org';

/** Inline-keyboard button row used by Telegram's reply_markup. */
export type InlineKeyboard = { text: string; callback_data: string }[][];

/** Result of one getUpdates poll: the raw payload plus the computed next offset. */
export interface IPollResult {
  updates: ITelegramApiResponse;
  nextOffset: number;
}

/** Client for the subset of Telegram Bot API endpoints used by this app. */
export default class TelegramApiClient {
  /** Bot token issued by BotFather (immutable per-instance). */
  private readonly _botToken: string;

  /** Default chat id used by sendHtmlMessage when not overridden. */
  private readonly _chatId: string;

  /**
   * Constructs a new client bound to a single bot+chat combination.
   *
   * @param botToken - Bot token from @BotFather.
   * @param chatId - Default chat id used by sendHtmlMessage when not overridden.
   */
  constructor(botToken: string, chatId: string) {
    this._botToken = botToken;
    this._chatId = chatId;
  }

  /**
   * Chat id this client targets.
   *
   * @returns The chat id passed at construction time.
   */
  public get chatId(): string { return this._chatId; }

  /**
   * Sends an HTML-parsed message, optionally with an inline keyboard.
   *
   * @param text - HTML message text (caller must pre-truncate/pre-escape).
   * @param replyMarkup - Optional inline keyboard rows.
   * @throws NetworkError when the Telegram API rejects the request.
   */
  public async sendHtmlMessage(text: string, replyMarkup?: InlineKeyboard): Promise<void> {
    const body: Record<string, unknown> = {
      chat_id: this._chatId, text, parse_mode: 'HTML',
    };
    if (replyMarkup) body.reply_markup = { inline_keyboard: replyMarkup };
    await this.postJson('sendMessage', body, 'Telegram API error');
  }

  /**
   * Registers the bot command list with Telegram.
   *
   * @param commands - Command list to register.
   * @throws NetworkError when setMyCommands rejects the request.
   */
  public async setMyCommands(
    commands: { command: string; description: string }[]
  ): Promise<void> {
    await this.postJson('setMyCommands', { commands }, 'setMyCommands failed');
  }

  /**
   * Fetches pending updates from Telegram starting at the given offset.
   *
   * @param offset - The update_id offset to pass to getUpdates.
   * @param timeoutSec - Long-poll timeout in seconds (Telegram-side).
   * @returns Procedure with updates and the next offset, or failure on HTTP error.
   */
  public async getUpdates(offset: number, timeoutSec: number): Promise<Procedure<IPollResult>> {
    const offsetQs = `offset=${String(offset)}`;
    const timeoutQs = `timeout=${String(timeoutSec)}`;
    const url = `${this.baseUrl()}/getUpdates?${offsetQs}&${timeoutQs}`;
    const response = await fetch(url);
    if (!response.ok) return fail(`getUpdates failed: ${String(response.status)}`);
    const data = await response.json() as ITelegramApiResponse;
    const last = data.result?.at(-1);
    const lastId = last ? last.update_id : offset - 1;
    return succeed({ updates: data, nextOffset: lastId + 1 });
  }

  /**
   * Fetches the latest update_id to use as a starting offset.
   *
   * @returns The next offset (latest update_id + 1), or 0 on failure.
   */
  public async getLatestOffset(): Promise<number> {
    const url = `${this.baseUrl()}/getUpdates?offset=-1`;
    const response = await fetch(url);
    if (!response.ok) return 0;
    const data = await response.json() as ITelegramApiResponse;
    const lastResult = data.result?.at(-1);
    return lastResult ? lastResult.update_id + 1 : 0;
  }

  /**
   * Confirms updates up to the given offset (best-effort, never throws).
   *
   * @param offset - The offset to confirm.
   */
  public async confirmOffset(offset: number): Promise<void> {
    try {
      const url = `${this.baseUrl()}/getUpdates?offset=${String(offset)}&timeout=0`;
      await fetch(url);
    } catch {
      // Non-critical — getLatestOffset() will still work.
    }
  }

  /**
   * Looks up the file_path for a given file_id via getFile.
   *
   * @param fileId - The Telegram file_id.
   * @returns The file_path string, or false when unavailable.
   */
  public async getFilePath(fileId: string): Promise<string | false> {
    const fileResponse = await fetch(`${this.baseUrl()}/getFile?file_id=${fileId}`);
    if (!fileResponse.ok) return false;
    const fileData = await fileResponse.json() as {
      ok: boolean; result?: { file_path: string };
    };
    if (!fileData.ok || !fileData.result?.file_path) return false;
    return fileData.result.file_path;
  }

  /**
   * Downloads file content from the Telegram file storage.
   *
   * @param filePath - The Telegram file_path returned by {@link getFilePath}.
   * @returns Procedure with the binary Buffer, or failure on HTTP error.
   */
  public async downloadFile(filePath: string): Promise<Procedure<Buffer>> {
    const downloadUrl = `${TELEGRAM_API}/file/bot${this._botToken}/${filePath}`;
    const imageResponse = await fetch(downloadUrl);
    if (!imageResponse.ok) return fail(`Photo download failed: ${String(imageResponse.status)}`);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return succeed(buffer);
  }

  /**
   * Builds the base URL for Telegram Bot API endpoints (`.../bot<token>`).
   *
   * @returns The base URL string used by every endpoint helper.
   */
  private baseUrl(): string {
    return `${TELEGRAM_API}/bot${this._botToken}`;
  }

  /**
   * Posts a JSON body to a Telegram endpoint and throws on non-2xx responses.
   *
   * @param endpoint - Endpoint name (e.g., `sendMessage`).
   * @param body - JSON-serializable request body.
   * @param errorLabel - Prefix used in {@link NetworkError} messages on failure.
   * @throws NetworkError when the response is not OK.
   */
  private async postJson(
    endpoint: string, body: unknown, errorLabel: string
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl()}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const respBody = await response.text();
      throw new NetworkError(`${errorLabel} ${String(response.status)}: ${respBody}`);
    }
  }
}
