/**
 * TelegramPoller - Polls Telegram /getUpdates for incoming messages
 * Filters by chatId for security, dispatches commands to handler
 */

import { TelegramApiResponse, TelegramCallbackQuery } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import { getLogger } from '../Logger/Index.js';

const TELEGRAM_API = 'https://api.telegram.org';
const POLL_TIMEOUT = 30;

export class TelegramPoller {
  private offset = 0;
  private running = false;
  private startedAt = 0;
  private abortController: AbortController | null = null;

  constructor(
    private botToken: string,
    private chatId: string,
    private onMessage: (text: string) => Promise<void>
  ) {}

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

  stop(): void {
    this.running = false;
    this.abortController?.abort();
  }

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

  private async applyUpdates(data: TelegramApiResponse): Promise<void> {
    if (!data.ok || !data.result?.length) return;
    for (const update of data.result) {
      this.offset = update.update_id + 1;
      await this.processUpdate(update.message);
      await this.processCallbackQuery(update.callback_query);
    }
  }

  private async processUpdate(
    message: { text?: string; chat: { id: number }; date: number } | undefined
  ): Promise<void> {
    if (!message?.text) return;
    if (String(message.chat.id) !== this.chatId) return;
    if (message.date < this.startedAt) return;
    await this.onMessage(message.text);
  }

  private async processCallbackQuery(query: TelegramCallbackQuery | undefined): Promise<void> {
    if (!query?.data) return;
    if (String(query.message?.chat.id) !== this.chatId) return;
    await this.answerCallbackQuery(query.id);
    await this.onMessage(query.data);
  }

  private async answerCallbackQuery(queryId: string): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/answerCallbackQuery`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: queryId }),
    }).catch(() => { /* non-critical */ });
  }

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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
