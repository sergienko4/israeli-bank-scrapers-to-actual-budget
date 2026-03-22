/**
 * TelegramPoller - Polls Telegram /getUpdates for incoming messages
 * Filters by chatId for security, dispatches commands to handler
 */

import { getLogger } from '../Logger/Index.js';
import type {
  ITelegramApiResponse, ITelegramCallbackQuery,
  ITelegramUpdate, Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';

const TELEGRAM_API = 'https://api.telegram.org';
const POLL_TIMEOUT = 30;

/** Long-polls the Telegram Bot API for updates and dispatches them to a handler. */
export default class TelegramPoller {
  private _offset = 0;
  private _running = false;
  private _startedAt = 0;
  private _abortController: AbortController | null = null;

  /**
   * Creates a TelegramPoller for the given bot and chat.
   * @param botToken - The Telegram Bot API token.
   * @param chatId - The chat ID to filter updates from (security boundary).
   * @param onMessage - Async callback invoked for each incoming message or callback query text.
   */
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    private readonly onMessage: (text: string) => Promise<Procedure<{ status: string }>>
  ) {}


  /**
   * Starts the long-poll loop, blocking until stop() is called.
   * Clears any old pending messages before entering the loop.
   * @returns Procedure indicating the poll loop has ended.
   */
  public async start(): Promise<Procedure<{ status: string }>> {
    this._running = true;
    this._startedAt = Math.floor(Date.now() / 1000);
    await this.clearOldMessages();
    getLogger().info('🤖 Telegram command listener started');
    return this.pollLoop();
  }

  /**
   * Stops the poll loop and aborts any in-flight HTTP request.
   * @returns Procedure indicating the poller was stopped.
   */
  public stop(): Procedure<{ status: string }> {
    this._running = false;
    this._abortController?.abort();
    return succeed({ status: 'stopped' });
  }

  /**
   * Stops the poller and confirms all processed updates with Telegram.
   * Makes a final getUpdates call with the current offset so Telegram
   * marks all prior updates as acknowledged.
   * @returns Procedure indicating the flush status.
   */
  public async stopAndFlush(): Promise<Procedure<{ status: string }>> {
    this.stop();
    if (this._offset === 0) return succeed({ status: 'nothing-to-flush' });
    try {
      const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates` +
        `?offset=${String(this._offset)}&timeout=0`;
      await fetch(url);
    } catch {
      // Non-critical
    }
    return succeed({ status: 'flushed' });
  }

  /**
   * Recursively runs the poll loop until the poller is stopped.
   * @returns Procedure indicating the loop has ended.
   */
  private async pollLoop(): Promise<Procedure<{ status: string }>> {
    if (!this._running) return succeed({ status: 'stopped' });
    await this.runOnePollCycle();
    return this.pollLoop();
  }

  /**
   * Executes one poll cycle with error handling and backoff on failure.
   * @returns Procedure indicating the cycle result.
   */
  private async runOnePollCycle(): Promise<Procedure<{ status: string }>> {
    try {
      await this.poll();
      return succeed({ status: 'poll-ok' });
    } catch (error) {
      getLogger().error(`⚠️  Telegram poll error: ${errorMessage(error)}`);
      await TelegramPoller.sleep(5000);
      return succeed({ status: 'poll-error-recovered' });
    }
  }

  /**
   * Executes one long-poll request and processes any returned updates.
   * @returns Procedure indicating the poll cycle result.
   */
  private async poll(): Promise<Procedure<{ status: string }>> {
    this._abortController = new AbortController();
    const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates` +
      `?offset=${String(this._offset)}&timeout=${String(POLL_TIMEOUT)}`;
    try {
      const response = await fetch(url, { signal: this._abortController.signal });
      if (!response.ok) return succeed({ status: 'poll-http-error' });
      await this.applyUpdates(await response.json() as ITelegramApiResponse);
      return succeed({ status: 'poll-complete' });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return succeed({ status: 'poll-aborted' });
      }
      throw err;
    } finally {
      this._abortController = null;
    }
  }

  /**
   * Processes a batch of Telegram updates, advancing the offset and dispatching each one.
   * @param data - The parsed ITelegramApiResponse from a getUpdates call.
   * @returns Procedure indicating the updates were applied.
   */
  private async applyUpdates(data: ITelegramApiResponse): Promise<Procedure<{ status: string }>> {
    if (!data.ok || !data.result?.length) return succeed({ status: 'no-updates' });
    return this.processUpdatesSequentially(data.result, 0);
  }

  /**
   * Recursively processes updates from the array starting at the given index.
   * @param updates - The array of ITelegramUpdate objects to process.
   * @param index - Zero-based index of the next update to process.
   * @returns Procedure indicating all updates have been processed.
   */
  private async processUpdatesSequentially(
    updates: ITelegramUpdate[], index: number
  ): Promise<Procedure<{ status: string }>> {
    if (index >= updates.length) return succeed({ status: 'updates-applied' });
    await this.processSingleUpdate(updates[index]);
    return this.processUpdatesSequentially(updates, index + 1);
  }

  /**
   * Processes a single Telegram update: message and/or callback query.
   * @param update - The ITelegramUpdate to process.
   * @returns Procedure indicating the update was processed.
   */
  private async processSingleUpdate(
    update: ITelegramUpdate
  ): Promise<Procedure<{ status: string }>> {
    this._offset = update.update_id + 1;
    await this.processUpdate(update.message);
    await this.processCallbackQuery(update.callback_query);
    return succeed({ status: 'update-processed' });
  }

  /**
   * Dispatches a plain message update to the onMessage handler if it passes all filters.
   * @param message - The Telegram message object from the update, or undefined.
   * @returns Procedure indicating the message dispatch result.
   */
  private async processUpdate(
    message: { text?: string; chat: { id: number }; date: number } | undefined
  ): Promise<Procedure<{ status: string }>> {
    if (!message?.text) return succeed({ status: 'no-message' });
    if (String(message.chat.id) !== this.chatId) return succeed({ status: 'wrong-chat' });
    if (message.date < this._startedAt) return succeed({ status: 'stale-message' });
    await this.onMessage(message.text);
    return succeed({ status: 'message-dispatched' });
  }

  /**
   * Answers and dispatches an inline keyboard callback query.
   * @param query - The ITelegramCallbackQuery from the update, or undefined.
   * @returns Procedure indicating the callback query dispatch result.
   */
  private async processCallbackQuery(
    query: ITelegramCallbackQuery | undefined
  ): Promise<Procedure<{ status: string }>> {
    if (!query?.data) return succeed({ status: 'no-callback' });
    if (String(query.message?.chat.id) !== this.chatId) return succeed({ status: 'wrong-chat' });
    await this.answerCallbackQuery(query.id);
    await this.onMessage(query.data);
    return succeed({ status: 'callback-dispatched' });
  }

  /**
   * Sends an answerCallbackQuery to remove the loading indicator from the inline button.
   * @param queryId - The callback_query_id to acknowledge.
   * @returns Procedure indicating the callback query was answered.
   */
  private async answerCallbackQuery(queryId: string): Promise<Procedure<{ status: string }>> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/answerCallbackQuery`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: queryId }),
    }).catch(() => { /* non-critical */ });
    return succeed({ status: 'answered' });
  }


  /**
   * Sets the offset to skip all messages that arrived before the bot started.
   * Prevents replaying stale commands from a previous session.
   * @returns Procedure indicating the old messages were cleared.
   */
  private async clearOldMessages(): Promise<Procedure<{ status: string }>> {
    try {
      const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates?offset=-1`;
      const response = await fetch(url);
      if (!response.ok) return succeed({ status: 'clear-failed' });

      const data = await response.json() as ITelegramApiResponse;
      const lastUpdate = data.ok ? data.result?.at(-1) : undefined;
      if (lastUpdate) {
        this._offset = lastUpdate.update_id + 1;
      }
      return succeed({ status: 'cleared' });
    } catch {
      // Ignore - will start from current
      return succeed({ status: 'clear-error' });
    }
  }

  /**
   * Pauses execution for the given duration.
   * @param ms - Duration in milliseconds to wait.
   * @returns Promise that resolves after the delay.
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise<void>(resolve => {
      const timer = ms;
      globalThis.setTimeout(resolve, timer);
    });
  }
}
