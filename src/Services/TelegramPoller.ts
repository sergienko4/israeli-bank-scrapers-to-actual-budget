/**
 * TelegramPoller — long-poll lifecycle + error-recovery orchestrator.
 *
 * Thin shell around {@link TelegramPollHttp} (HTTP), the pure helpers in
 * `./TelegramPollBackoff.js` (backoff math), and
 * {@link TelegramUpdateDispatcher} (update routing).
 *
 * Public class API is byte-identical to the pre-PR-7 version.
 */

import { getLogger } from '../Logger/Index.js';
import type { Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import {
  backoffSeconds, computeBackoff, isFatalHttpCode,
} from './TelegramPollBackoff.js';
import TelegramPollHttp, { type PollOutcome } from './TelegramPollHttp.js';
import TelegramUpdateDispatcher, {
  type PhotoHandler, type TextHandler,
} from './TelegramUpdateDispatcher.js';

const MAX_CONSECUTIVE_ERRORS = 60;

/** Long-polls the Telegram Bot API for updates and dispatches them to a handler. */
export default class TelegramPoller {
  private readonly _http: TelegramPollHttp;
  private _offset = 0;
  private _running = false;
  private _startedAt = 0;
  private _abortController: AbortController | null = null;
  private _sleepController: AbortController | null = null;
  private _consecutiveErrors = 0;
  private _runId = 0;
  private _onPhoto?: PhotoHandler;

  /**
   * Creates a TelegramPoller for the given bot and chat.
   *
   * @param botToken - The Telegram Bot API token.
   * @param chatId - The chat ID to filter from.
   * @param onMessage - Async callback for text messages and callback data.
   */
  constructor(
    botToken: string,
    private readonly chatId: string,
    private readonly onMessage: TextHandler
  ) {
    this._http = new TelegramPollHttp(botToken);
  }

  /**
   * Sets an optional photo handler for receipt import.
   *
   * @param handler - Callback invoked with file_id (and optional caption) on photo.
   * @returns Nothing — this is a side-effecting setter.
   */
  public setPhotoHandler(handler: PhotoHandler): void {
    this._onPhoto = handler;
  }

  /**
   * Starts the long-poll loop, blocking until stop() is called.
   * Clears any old pending messages before entering the loop.
   *
   * @returns Procedure indicating the poll loop has ended.
   */
  public async start(): Promise<Procedure<{ status: string }>> {
    this._running = true;
    const runId = ++this._runId;
    this._startedAt = Math.floor(Date.now() / 1000);
    this._consecutiveErrors = 0;
    await this.clearOldMessages();
    if (this._runId !== runId) return succeed({ status: 'superseded' });
    getLogger().info('🤖 Telegram command listener started');
    return await this.pollLoop(runId);
  }

  /**
   * Stops the poll loop and aborts any in-flight HTTP request.
   *
   * @returns Procedure indicating the poller was stopped.
   */
  public stop(): Procedure<{ status: string }> {
    this._running = false;
    this._abortController?.abort();
    this._sleepController?.abort();
    return succeed({ status: 'stopped' });
  }

  /**
   * Stops the poller and confirms all processed updates with Telegram so a
   * future getUpdates does not replay them.
   *
   * @returns Procedure indicating the flush status.
   */
  public async stopAndFlush(): Promise<Procedure<{ status: string }>> {
    this._runId++;
    this.stop();
    if (this._offset === 0) return succeed({ status: 'nothing-to-flush' });
    return await this._http.flushOffset(this._offset);
  }

  /**
   * Iteratively runs the poll loop until stopped or superseded by a new run.
   *
   * @param runId - Token captured at start() to detect stale loops.
   * @returns Procedure indicating the loop has ended.
   */
  private async pollLoop(runId: number): Promise<Procedure<{ status: string }>> {
    while (this._running && this._runId === runId) {
      await this.runOnePollCycle();
    }
    return succeed({ status: 'stopped' });
  }

  /**
   * Executes one poll cycle: HTTP request + dispatch + error classification.
   *
   * @returns Procedure indicating the cycle result.
   */
  private async runOnePollCycle(): Promise<Procedure<{ status: string }>> {
    try {
      const outcome = await this.fetchUpdates();
      if (outcome.kind === 'http-error') {
        const code = String(outcome.statusCode);
        return await this.handlePollHttpError(code);
      }
      if (outcome.kind === 'aborted') return succeed({ status: 'poll-aborted' });
      await this.dispatchUpdates(outcome);
      this._consecutiveErrors = 0;
      return succeed({ status: 'poll-ok' });
    } catch (error: unknown) {
      return await this.handlePollException(error);
    }
  }

  /**
   * Runs one long-poll HTTP request with a fresh abort controller.
   *
   * @returns The PollOutcome describing data, http-error, or abort.
   */
  private async fetchUpdates(): Promise<PollOutcome> {
    this._abortController = new AbortController();
    try {
      return await this._http.poll(this._offset, this._abortController.signal);
    } finally {
      this._abortController = null;
    }
  }

  /**
   * Dispatches the returned updates to the registered handlers and advances
   * the poll offset.
   *
   * @param outcome - The data outcome from a successful poll.
   * @returns Resolves when all updates have been dispatched.
   */
  private async dispatchUpdates(
    outcome: PollOutcome & { kind: 'data' }
  ): Promise<Procedure<{ status: string }>> {
    const dispatcher = this.buildDispatcher();
    const result = await dispatcher.apply(outcome.data);
    if (result.success && result.data.nextOffset !== undefined) {
      this._offset = result.data.nextOffset;
    }
    return succeed({ status: 'dispatched' });
  }

  /**
   * Builds a dispatcher bound to the current handler set.
   *
   * @returns A new TelegramUpdateDispatcher instance.
   */
  private buildDispatcher(): TelegramUpdateDispatcher {
    return new TelegramUpdateDispatcher(this._http, {
      chatId: this.chatId,
      startedAt: this._startedAt,
      onText: this.onMessage,
      onPhoto: this._onPhoto,
    });
  }

  /**
   * Handles an HTTP error from poll(), stopping on fatal codes or applying backoff.
   *
   * @param httpCode - The HTTP status code as a string.
   * @returns Procedure indicating the error was handled.
   */
  private async handlePollHttpError(
    httpCode: string
  ): Promise<Procedure<{ status: string }>> {
    this._consecutiveErrors++;
    if (isFatalHttpCode(httpCode)) {
      const log = `🛑 Telegram poll fatal error (HTTP ${httpCode}) — stopping poller`;
      getLogger().error(log);
      this._running = false;
      return succeed({ status: 'poll-fatal-stopped' });
    }
    return await this.backoffOrTrip(`HTTP ${httpCode}`);
  }

  /**
   * Handles an exception thrown during poll(), applying backoff.
   *
   * @param error - The unknown error from the poll attempt.
   * @returns Procedure indicating the error was recovered.
   */
  private async handlePollException(
    error: unknown
  ): Promise<Procedure<{ status: string }>> {
    this._consecutiveErrors++;
    const detail = errorMessage(error);
    return await this.backoffOrTrip(detail);
  }

  /**
   * Trips the circuit breaker or logs retry and sleeps with backoff.
   *
   * @param detail - Human-readable error detail for the log message.
   * @returns Procedure indicating the backoff or circuit-breaker result.
   */
  private async backoffOrTrip(
    detail: string
  ): Promise<Procedure<{ status: string }>> {
    if (this._consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      const max = String(MAX_CONSECUTIVE_ERRORS);
      getLogger().error(`🛑 Telegram poll ${detail} — ${max} errors, stopping`);
      this._running = false;
      return succeed({ status: 'poll-circuit-breaker' });
    }
    return await this.logAndSleep(detail);
  }

  /**
   * Logs a retryable error and sleeps with exponential backoff.
   *
   * @param detail - Error detail for the log message.
   * @returns Procedure with handled status.
   */
  private async logAndSleep(detail: string): Promise<Procedure<{ status: string }>> {
    const count = String(this._consecutiveErrors);
    const max = String(MAX_CONSECUTIVE_ERRORS);
    const seconds = backoffSeconds(this._consecutiveErrors);
    getLogger().warn(
      `⚠️  Telegram poll ${detail} (${count}/${max}) — retrying in ${seconds}s`
    );
    if (this._running) {
      const delay = computeBackoff(this._consecutiveErrors);
      await this.interruptibleSleep(delay);
    }
    return succeed({ status: 'poll-error-handled' });
  }

  /**
   * Sets the offset to skip all messages that arrived before the bot started.
   * Prevents replaying stale commands from a previous session.
   *
   * @returns Procedure indicating the initial offset was set.
   */
  private async clearOldMessages(): Promise<Procedure<{ status: string }>> {
    const result = await this._http.getInitialOffset();
    if (result.success && result.data.offset !== 0) {
      this._offset = result.data.offset;
    }
    return succeed({ status: 'initial-offset-set' });
  }

  /**
   * Sleeps for the given duration, but can be interrupted by stop().
   *
   * @param ms - Duration in milliseconds to wait.
   * @returns Procedure indicating the sleep completed or was aborted.
   */
  private async interruptibleSleep(
    ms: number
  ): Promise<Procedure<{ status: string }>> {
    this._sleepController = new AbortController();
    const signal = this._sleepController.signal;
    try {
      await new Promise<void>((resolve) => {
        const timer = globalThis.setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
          globalThis.clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    } finally {
      this._sleepController = null;
    }
    return succeed({ status: 'slept' });
  }
}
