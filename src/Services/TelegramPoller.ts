/**
 * TelegramPoller - Polls Telegram /getUpdates for incoming messages
 * Filters by chatId for security, dispatches commands to handler
 */

import type { TelegramApiResponse, TelegramCallbackQuery } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import { getLogger } from '../Logger/Index.js';

const TELEGRAM_API = 'https://api.telegram.org';
const POLL_TIMEOUT = 30;

/** Long-polls the Telegram Bot API for updates and dispatches them to a handler. */
export class TelegramPoller {
  private offset = 0;
  private running = false;
  private startedAt = 0;
  private abortController: AbortController | null = null;

  /**
   * Creates a TelegramPoller for the given bot and chat.
   * @param botToken - The Telegram Bot API token.
   * @param chatId - The chat ID to filter updates from (security boundary).
   * @param onMessage - Async callback invoked for each incoming message or callback query text.
   */
  constructor(
    private botToken: string,
    private chatId: string,
    private onMessage: (text: string) => Promise<void>
  ) {}


  /**
   * Starts the long-poll loop, blocking until stop() is called.
   * Clears any old pending messages before entering the loop.
   */
  async start(): Promise<void> {
    this.running = true;
    this.startedAt = Math.floor(Date.now() / 1000);
    await this.clearOldMessages();
    getLogger().info('🤖 Telegram command listener started');

    while (this.running) {
      try {
        await this.poll();
      } catch (error: unknown) {
        getLogger().error(`⚠️  Telegram poll error: ${errorMessage(error)}`);
        await this.sleep(5000);
      }
    }
  }

  /** Stops the poll loop and aborts any in-flight HTTP request. */
  stop(): void {
    this.running = false;
    this.abortController?.abort();
  }

  /**
   * Stops the poller and confirms all processed updates with Telegram.
   * Makes a final getUpdates call with the current offset so Telegram marks
   * all prior updates as acknowledged — prevents a child process from seeing
   * stale updates via getUpdates(offset=-1).
   */
  async stopAndFlush(): Promise<void> {
    this.stop();
    if (this.offset === 0) return;
    try {
      const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates` +
        `?offset=${this.offset}&timeout=0`;
      await fetch(url);
    } catch {
      // Non-critical — child process will still work via getLatestOffset()
    }
  }

  /** Executes one long-poll request and processes any returned updates. */
  private async poll(): Promise<void> {
    this.abortController = new AbortController();
    const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates` +
      `?offset=${this.offset}&timeout=${POLL_TIMEOUT}`;
    try {
      const response = await fetch(url, { signal: this.abortController.signal });
      if (!response.ok) return;
      await this.applyUpdates(await response.json() as TelegramApiResponse);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      throw err;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Processes a batch of Telegram updates, advancing the offset and dispatching each one.
   * @param data - The parsed TelegramApiResponse from a getUpdates call.
   */
  private async applyUpdates(data: TelegramApiResponse): Promise<void> {
    if (!data.ok || !data.result?.length) return;
    for (const update of data.result) {
      this.offset = update.update_id + 1;
      await this.processUpdate(update.message);
      await this.processCallbackQuery(update.callback_query);
    }
  }

  /**
   * Dispatches a plain message update to the onMessage handler if it passes all filters.
   * @param message - The Telegram message object from the update, or undefined.
   */
  private async processUpdate(
    message: { text?: string; chat: { id: number }; date: number } | undefined
  ): Promise<void> {
    if (!message?.text) return;
    if (String(message.chat.id) !== this.chatId) return;
    if (message.date < this.startedAt) return;
    await this.onMessage(message.text);
  }

  /**
   * Answers and dispatches an inline keyboard callback query.
   * @param query - The TelegramCallbackQuery from the update, or undefined.
   */
  private async processCallbackQuery(query: TelegramCallbackQuery | undefined): Promise<void> {
    if (!query?.data) return;
    if (String(query.message?.chat.id) !== this.chatId) return;
    await this.answerCallbackQuery(query.id);
    await this.onMessage(query.data);
  }

  /**
   * Sends an answerCallbackQuery to remove the loading indicator from the inline button.
   * @param queryId - The callback_query_id to acknowledge.
   */
  private async answerCallbackQuery(queryId: string): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/answerCallbackQuery`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: queryId }),
    }).catch(() => { /* non-critical */ });
  }


  /**
   * Sets the offset to skip all messages that arrived before the bot started.
   * Prevents replaying stale commands from a previous session.
   */
  private async clearOldMessages(): Promise<void> {
    try {
      const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates?offset=-1`;
      const response = await fetch(url);
      if (!response.ok) return;

      const data = await response.json() as TelegramApiResponse;
      if (data.ok && data.result?.length) {
        this.offset = data.result[data.result.length - 1].update_id + 1;
      }
    } catch {
      // Ignore - will start from current
    }
  }

  /**
   * Pauses execution for the given duration.
   * @param ms - Duration in milliseconds to wait.
   * @returns Promise that resolves after the delay.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
