/**
 * TelegramPollHttp — class wrapper for the long-poll HTTP surface used by
 * {@link TelegramPoller}. Each method maps to one Telegram Bot API endpoint
 * and keeps the bot token isolated from the orchestrator.
 *
 * Extracted from {@link TelegramPoller} (PR 7) so the network surface is
 * independently testable.
 */

import type { ITelegramApiResponse, Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';

const TELEGRAM_API = 'https://api.telegram.org';
const POLL_TIMEOUT = 30;

/** Result of a single poll() call — see TelegramPollHttp.poll. */
export type PollOutcome =
  | { kind: 'data'; data: ITelegramApiResponse }
  | { kind: 'http-error'; statusCode: number }
  | { kind: 'aborted' };

/** Wraps the Telegram Bot API getUpdates / answerCallbackQuery endpoints. */
export default class TelegramPollHttp {
  /**
   * Creates a new TelegramPollHttp bound to a single bot token.
   *
   * @param botToken - The Telegram Bot API token.
   */
  constructor(private readonly botToken: string) {}

  /**
   * Executes one long-poll HTTP request against getUpdates.
   *
   * @param offset - The update_id offset to fetch from.
   * @param signal - AbortSignal that allows the caller to cancel the request.
   * @returns Outcome describing the data, HTTP error, or abort.
   * @throws Error when fetch rejects for non-abort reasons (caller wraps).
   */
  public async poll(offset: number, signal: AbortSignal): Promise<PollOutcome> {
    try {
      const url = this.buildPollUrl(offset);
      const response = await fetch(url, { signal });
      if (!response.ok) {
        return { kind: 'http-error', statusCode: response.status };
      }
      const data = await response.json() as ITelegramApiResponse;
      return { kind: 'data', data };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { kind: 'aborted' };
      }
      throw err;
    }
  }

  /**
   * Calls getUpdates with offset=-1 to discover the most recent update_id
   * and returns the next offset so the poller skips stale messages.
   *
   * @returns Procedure with the next offset (0 when no prior updates exist).
   */
  public async getInitialOffset(): Promise<Procedure<{ offset: number }>> {
    try {
      const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates?offset=-1`;
      const response = await fetch(url);
      if (!response.ok) return succeed({ offset: 0 });
      const data = await response.json() as ITelegramApiResponse;
      const lastUpdate = data.ok ? data.result?.at(-1) : undefined;
      return succeed({ offset: lastUpdate ? lastUpdate.update_id + 1 : 0 });
    } catch {
      return succeed({ offset: 0 });
    }
  }

  /**
   * Sends a best-effort getUpdates call with timeout=0 to acknowledge all
   * processed updates up to the given offset.
   *
   * @param offset - The offset to acknowledge with Telegram.
   * @returns Procedure indicating the flush completed (always succeeds).
   */
  public async flushOffset(offset: number): Promise<Procedure<{ status: string }>> {
    try {
      const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates` +
        `?offset=${String(offset)}&timeout=0`;
      await fetch(url);
      return succeed({ status: 'flushed' });
    } catch {
      return succeed({ status: 'flush-failed-best-effort' });
    }
  }

  /**
   * Acknowledges an inline-keyboard callback query so Telegram removes the
   * spinner from the button. Errors are swallowed (best-effort).
   *
   * @param queryId - The callback_query_id to acknowledge.
   * @returns Procedure indicating the ack completed (always succeeds).
   */
  public async answerCallbackQuery(
    queryId: string
  ): Promise<Procedure<{ status: string }>> {
    try {
      const url = `${TELEGRAM_API}/bot${this.botToken}/answerCallbackQuery`;
      const body = JSON.stringify({ callback_query_id: queryId });
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      return succeed({ status: 'acked' });
    } catch {
      return succeed({ status: 'ack-failed-best-effort' });
    }
  }

  /**
   * Builds the long-poll URL for getUpdates with the configured timeout.
   *
   * @param offset - The update_id offset to pass to getUpdates.
   * @returns The fully-qualified getUpdates URL.
   */
  private buildPollUrl(offset: number): string {
    return `${TELEGRAM_API}/bot${this.botToken}/getUpdates` +
      `?offset=${String(offset)}&timeout=${String(POLL_TIMEOUT)}`;
  }
}
