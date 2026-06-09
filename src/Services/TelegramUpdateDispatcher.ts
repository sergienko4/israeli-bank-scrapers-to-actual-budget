/**
 * TelegramUpdateDispatcher — class wrapper for the update-routing logic
 * used by {@link TelegramPoller}. Owns message classification, chat-id
 * filtering and dispatch fan-out (text vs photo vs callback).
 *
 * Extracted from {@link TelegramPoller} (PR 7) so the routing surface is
 * independently testable.
 */

import type {
  ITelegramApiResponse, ITelegramCallbackQuery, ITelegramMessageData,
  ITelegramUpdate, Procedure,
} from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import type TelegramPollHttp from './TelegramPollHttp.js';

/** Async callback invoked with the text body of an incoming message or callback_data. */
export type TextHandler = (
  text: string
) => Promise<Procedure<{ status: string }>>;

/** Async callback invoked with the file_id of an incoming photo (and optional caption). */
export type PhotoHandler = (
  fileId: string, caption?: string
) => Promise<Procedure<{ status: string }>>;

/** Configuration the dispatcher needs to route + filter incoming updates. */
export interface IDispatcherConfig {
  chatId: string;
  startedAt: number;
  onText: TextHandler;
  onPhoto?: PhotoHandler;
}

/** Result of one TelegramUpdateDispatcher.apply call. */
export interface IApplyResult {
  /** Next poll offset; absent when no updates were dispatched. */
  nextOffset?: number;
}

/** Routes Telegram updates to text / photo / callback handlers. */
export default class TelegramUpdateDispatcher {
  /**
   * Creates a new TelegramUpdateDispatcher bound to one chat and handler set.
   *
   * @param http - HTTP client used to ack inline-keyboard callbacks.
   * @param config - Static dispatcher configuration (chat id, handlers, etc.).
   */
  constructor(
    private readonly http: TelegramPollHttp,
    private readonly config: IDispatcherConfig
  ) {}

  /**
   * Applies a batch of Telegram updates, returning the latest offset (one
   * past the last update_id) so the caller can advance its poll cursor.
   *
   * @param data - Parsed ITelegramApiResponse from a getUpdates call.
   * @returns Procedure with the next offset (omitted when no updates).
   */
  public async apply(
    data: ITelegramApiResponse
  ): Promise<Procedure<IApplyResult>> {
    if (!data.ok || !data.result?.length) {
      return succeed({});
    }
    const nextOffset = await this.processUpdatesSequentially(data.result);
    return succeed({ nextOffset });
  }

  /**
   * Iteratively processes updates in order, advancing the offset for each one.
   *
   * @param updates - The array of ITelegramUpdate objects to process.
   * @returns The offset to use for the next poll (one past the last update_id).
   */
  private async processUpdatesSequentially(
    updates: ITelegramUpdate[]
  ): Promise<number> {
    let nextOffset = 0;
    for (const update of updates) {
      nextOffset = update.update_id + 1;
      await this.processSingleUpdate(update);
    }
    return nextOffset;
  }

  /**
   * Processes a single Telegram update: message and/or callback query.
   *
   * @param update - The ITelegramUpdate to process.
   * @returns Procedure indicating the update was handled.
   */
  private async processSingleUpdate(
    update: ITelegramUpdate
  ): Promise<Procedure<{ status: string }>> {
    await this.dispatchMessage(update.message);
    await this.dispatchCallbackQuery(update.callback_query);
    return succeed({ status: 'update-processed' });
  }

  /**
   * Validates a message is from the expected chat and not stale (pre-start).
   *
   * @param message - The Telegram message data, or undefined.
   * @returns True if the message should be processed.
   */
  private isValidMessage(
    message: ITelegramMessageData | undefined
  ): message is ITelegramMessageData {
    if (!message?.text && !message?.photo?.length) return false;
    if (String(message.chat.id) !== this.config.chatId) return false;
    if (message.date < this.config.startedAt) return false;
    return true;
  }

  /**
   * Dispatches a message update (text or photo) to the registered handler.
   *
   * @param message - The Telegram message data, or undefined.
   * @returns Procedure indicating the dispatch result.
   */
  private async dispatchMessage(
    message: ITelegramMessageData | undefined
  ): Promise<Procedure<{ status: string }>> {
    if (!this.isValidMessage(message)) return succeed({ status: 'skip-invalid' });
    if (message.photo && this.config.onPhoto) {
      return await this.dispatchPhoto(message);
    }
    if (message.text) await this.config.onText(message.text);
    return succeed({ status: 'text-dispatched' });
  }

  /**
   * Dispatches the largest photo in the message to the photo handler.
   *
   * @param message - The Telegram message containing a photo array.
   * @returns Procedure indicating the dispatch result.
   */
  private async dispatchPhoto(
    message: ITelegramMessageData
  ): Promise<Procedure<{ status: string }>> {
    const onPhoto = this.config.onPhoto;
    if (!onPhoto) return succeed({ status: 'skip-no-handler' });
    const largest = message.photo?.at(-1);
    if (!largest) return succeed({ status: 'skip-no-photo' });
    await onPhoto(largest.file_id, message.caption);
    return succeed({ status: 'photo-dispatched' });
  }

  /**
   * Acknowledges and dispatches an inline-keyboard callback query.
   *
   * @param query - The callback query from the update, or undefined.
   * @returns Procedure indicating the dispatch result.
   */
  private async dispatchCallbackQuery(
    query: ITelegramCallbackQuery | undefined
  ): Promise<Procedure<{ status: string }>> {
    if (!query?.data) return succeed({ status: 'skip-no-callback' });
    if (String(query.message?.chat.id) !== this.config.chatId) {
      return succeed({ status: 'skip-wrong-chat' });
    }
    await this.http.answerCallbackQuery(query.id);
    await this.config.onText(query.data);
    return succeed({ status: 'callback-dispatched' });
  }
}
