/**
 * TelegramPoller - Polls Telegram /getUpdates for incoming messages
 * Filters by chatId for security, dispatches commands to handler
 */

import { getLogger } from '../Logger/Index.js';
import type {
  ITelegramApiResponse, ITelegramCallbackQuery, ITelegramMessageData,
  ITelegramUpdate, Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';

const TELEGRAM_API = 'https://api.telegram.org';
const POLL_TIMEOUT = 30;
const BASE_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 300_000;
const MAX_CONSECUTIVE_ERRORS = 60;

/** Long-polls the Telegram Bot API for updates and dispatches them to a handler. */
export default class TelegramPoller {
  private _offset = 0;
  private _running = false;
  private _startedAt = 0;
  private _abortController: AbortController | null = null;
  private _consecutiveErrors = 0;

  private _onPhoto?: (
    fileId: string, caption?: string
  ) => Promise<Procedure<{ status: string }>>;

  /**
   * Creates a TelegramPoller for the given bot and chat.
   * @param botToken - The Telegram Bot API token.
   * @param chatId - The chat ID to filter from.
   * @param onMessage - Async callback for text messages.
   */
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    private readonly onMessage: (
      text: string
    ) => Promise<Procedure<{ status: string }>>
  ) {}

  /**
   * Sets an optional photo handler for receipt import.
   * @param handler - Callback invoked with file_id on photo.
   */
  public setPhotoHandler(handler: (
    fileId: string, caption?: string
  ) => Promise<Procedure<{ status: string }>>): void {
    this._onPhoto = handler;
  }


  /**
   * Starts the long-poll loop, blocking until stop() is called.
   * Clears any old pending messages before entering the loop.
   * @returns Procedure indicating the poll loop has ended.
   */
  public async start(): Promise<Procedure<{ status: string }>> {
    this._running = true;
    this._startedAt = Math.floor(Date.now() / 1000);
    this._consecutiveErrors = 0;
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
   * Iteratively runs the poll loop until the poller is stopped.
   * @returns Procedure indicating the loop has ended.
   */
  private async pollLoop(): Promise<Procedure<{ status: string }>> {
    while (this._running) {
      await this.runOnePollCycle();
    }
    return succeed({ status: 'stopped' });
  }

  /**
   * Executes one poll cycle with error classification and escalating backoff.
   * @returns Procedure indicating the cycle result.
   */
  private async runOnePollCycle(): Promise<Procedure<{ status: string }>> {
    try {
      const pollResult = await this.poll();
      if (!pollResult.success || !pollResult.data.status.startsWith('poll-http-error')) {
        this._consecutiveErrors = 0;
        return succeed({ status: 'poll-ok' });
      }
      return await this.handlePollHttpError(pollResult.data.status);
    } catch (error: unknown) {
      return await this.handlePollException(error);
    }
  }

  /**
   * Handles an HTTP error from poll(), stopping on fatal codes or applying backoff.
   * @param status - The poll result status containing the HTTP code.
   * @returns Procedure indicating the error was handled.
   */
  private async handlePollHttpError(
    status: string
  ): Promise<Procedure<{ status: string }>> {
    this._consecutiveErrors++;
    const httpCode = status.replace('poll-http-error-', '');
    if (TelegramPoller.isFatalHttpCode(httpCode)) {
      getLogger().error(
        `🛑 Telegram poll fatal error (HTTP ${httpCode}) — stopping poller`
      );
      this._running = false;
      return succeed({ status: 'poll-fatal-stopped' });
    }
    this.logRetryableError(`HTTP ${httpCode}`);
    return this.applyBackoffOrTrip();
  }

  /**
   * Handles an exception thrown during poll(), applying backoff.
   * @param error - The unknown error from the poll attempt.
   * @returns Procedure indicating the error was recovered.
   */
  private async handlePollException(
    error: unknown
  ): Promise<Procedure<{ status: string }>> {
    this._consecutiveErrors++;
    const detail = errorMessage(error);
    this.logRetryableError(detail);
    return await this.applyBackoffOrTrip();
  }

  /**
   * Logs a retryable error with the current error count and computed backoff.
   * @param detail - Human-readable error detail (e.g. "HTTP 500" or error message).
   */
  private logRetryableError(detail: string): void {
    const backoffSec = TelegramPoller.backoffSeconds(this._consecutiveErrors);
    getLogger().warn(
      `⚠️  Telegram poll ${detail}` +
      ` (${String(this._consecutiveErrors)}/${String(MAX_CONSECUTIVE_ERRORS)})` +
      ` — retrying in ${backoffSec}s`
    );
  }

  /**
   * Trips the circuit breaker if error limit is reached, otherwise sleeps with backoff.
   * @returns Procedure indicating the backoff or circuit-breaker result.
   */
  private async applyBackoffOrTrip(): Promise<Procedure<{ status: string }>> {
    if (this._consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      getLogger().error(
        `🛑 Telegram poll: ${String(MAX_CONSECUTIVE_ERRORS)} consecutive errors — stopping poller`
      );
      this._running = false;
      return succeed({ status: 'poll-circuit-breaker' });
    }
    const backoff = TelegramPoller.computeBackoff(this._consecutiveErrors);
    if (this._running) await TelegramPoller.sleep(backoff);
    return succeed({ status: 'poll-error-handled' });
  }

  /**
   * Returns true for HTTP codes that indicate a permanent/auth failure.
   * @param code - HTTP status code as string.
   * @returns True if the poller should stop permanently.
   */
  private static isFatalHttpCode(code: string): boolean {
    return code === '401' || code === '403' || code === '409';
  }

  /**
   * Computes exponential backoff capped at MAX_BACKOFF_MS.
   * @param errorCount - Number of consecutive errors.
   * @returns Backoff duration in milliseconds.
   */
  private static computeBackoff(errorCount: number): number {
    return Math.min(BASE_BACKOFF_MS * 2 ** (errorCount - 1), MAX_BACKOFF_MS);
  }

  /**
   * Returns the backoff duration in whole seconds as a string for logging.
   * @param errorCount - Number of consecutive errors.
   * @returns Backoff seconds as a string.
   */
  private static backoffSeconds(errorCount: number): string {
    const ms = TelegramPoller.computeBackoff(errorCount);
    const seconds = Math.round(ms / 1000);
    return String(seconds);
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
      if (!response.ok) {
        return succeed({ status: `poll-http-error-${String(response.status)}` });
      }
      await this.applyUpdates(await response.json() as ITelegramApiResponse);
      return succeed({ status: 'poll-complete' });
    } catch (err: unknown) {
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
    return this.processUpdatesSequentially(data.result);
  }

  /**
   * Iteratively processes all updates from the array in order.
   * @param updates - The array of ITelegramUpdate objects to process.
   * @returns Procedure indicating all updates have been processed.
   */
  private async processUpdatesSequentially(
    updates: ITelegramUpdate[]
  ): Promise<Procedure<{ status: string }>> {
    for (const update of updates) {
      await this.processSingleUpdate(update);
    }
    return succeed({ status: 'updates-applied' });
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
   * Validates a message is from the expected chat and not stale.
   * @param message - The Telegram message data, or undefined.
   * @returns True if the message should be processed.
   */
  private isValidMessage(
    message: ITelegramMessageData | undefined
  ): message is ITelegramMessageData {
    if (!message?.text && !message?.photo?.length) return false;
    if (String(message.chat.id) !== this.chatId) return false;
    if (message.date < this._startedAt) return false;
    return true;
  }

  /**
   * Dispatches a message update (text or photo) to the appropriate handler.
   * @param message - The Telegram message data, or undefined.
   * @returns Procedure indicating the message dispatch result.
   */
  private async processUpdate(
    message: ITelegramMessageData | undefined
  ): Promise<Procedure<{ status: string }>> {
    if (!this.isValidMessage(message)) return succeed({ status: 'skipped' });
    if (message.photo && this._onPhoto) return this.dispatchPhoto(message);
    if (message.text) await this.onMessage(message.text);
    return succeed({ status: 'dispatched' });
  }

  /**
   * Dispatches a photo message to the registered photo handler.
   * @param message - The Telegram message containing a photo array.
   * @returns Procedure indicating the photo was dispatched.
   */
  private async dispatchPhoto(
    message: ITelegramMessageData
  ): Promise<Procedure<{ status: string }>> {
    const largest = message.photo?.at(-1);
    if (!largest || !this._onPhoto) return succeed({ status: 'no-photo-handler' });
    await this._onPhoto(largest.file_id, message.caption);
    return succeed({ status: 'photo-dispatched' });
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
      globalThis.setTimeout(resolve, ms);
    });
  }
}
