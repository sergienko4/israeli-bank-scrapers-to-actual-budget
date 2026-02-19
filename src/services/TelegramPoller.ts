/**
 * TelegramPoller - Polls Telegram /getUpdates for incoming messages
 * Filters by chatId for security, dispatches commands to handler
 */

import { TelegramApiResponse } from '../types/index.js';
import { errorMessage } from '../utils/index.js';

const TELEGRAM_API = 'https://api.telegram.org';
const POLL_TIMEOUT = 30;

export class TelegramPoller {
  private offset = 0;
  private running = false;
  private startedAt = 0;

  constructor(
    private botToken: string,
    private chatId: string,
    private onMessage: (text: string) => Promise<void>
  ) {}

  async start(): Promise<void> {
    this.running = true;
    this.startedAt = Math.floor(Date.now() / 1000);
    await this.clearOldMessages();
    console.log('🤖 Telegram command listener started');

    while (this.running) {
      try {
        await this.poll();
      } catch (error: unknown) {
        console.error('⚠️  Telegram poll error:', errorMessage(error));
        await this.sleep(5000);
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  private async poll(): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates?offset=${this.offset}&timeout=${POLL_TIMEOUT}`;
    const response = await fetch(url);
    if (!response.ok) return;

    const data = await response.json() as TelegramApiResponse;
    if (!data.ok || !data.result?.length) return;
    for (const update of data.result) {
      this.offset = update.update_id + 1;
      await this.processUpdate(update.message);
    }
  }

  private async processUpdate(message: { text?: string; chat: { id: number }; date: number } | undefined): Promise<void> {
    if (!message?.text) return;
    if (String(message.chat.id) !== this.chatId) return;
    if (message.date < this.startedAt) return;
    await this.onMessage(message.text);
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
