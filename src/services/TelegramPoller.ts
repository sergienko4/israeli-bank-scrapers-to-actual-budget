/**
 * TelegramPoller - Polls Telegram /getUpdates for incoming messages
 * Filters by chatId for security, dispatches commands to handler
 */

const TELEGRAM_API = 'https://api.telegram.org';
const POLL_TIMEOUT = 30; // seconds (Telegram long polling)

export class TelegramPoller {
  private offset = 0;
  private running = false;

  constructor(
    private botToken: string,
    private chatId: string,
    private onMessage: (text: string) => Promise<void>
  ) {}

  async start(): Promise<void> {
    this.running = true;
    console.log('🤖 Telegram command listener started');

    while (this.running) {
      try {
        await this.poll();
      } catch (error: any) {
        console.error('⚠️  Telegram poll error:', error.message);
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

    const data: any = await response.json();
    if (!data.ok || !data.result?.length) return;

    for (const update of data.result) {
      this.offset = update.update_id + 1;

      const message = update.message;
      if (!message?.text) continue;
      if (String(message.chat.id) !== this.chatId) continue;

      await this.onMessage(message.text);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
