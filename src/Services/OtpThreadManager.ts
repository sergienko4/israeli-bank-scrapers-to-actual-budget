/**
 * OtpThreadManager — auto-creates and caches a dedicated Telegram forum topic
 * for OTP codes. Requires Topics mode enabled in @BotFather for the bot.
 *
 * Usage: call setOtpThreadManager() on TelegramNotifier at startup.
 * On first OTP request, the thread is created (if Topics enabled) and cached.
 * Falls back silently to main chat if Topics mode is off.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getLogger } from '../Logger/index.js';
import { errorMessage } from '../Utils/index.js';

const TELEGRAM_API = 'https://api.telegram.org';
const OTP_TOPIC_NAME = '🔐 OTP Codes';
const CACHE_FILE = 'otp-thread.json';

interface OtpThreadCache { threadId: number }

export class OtpThreadManager {
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    private readonly cacheDir: string,
  ) {}

  async getOrCreateThreadId(): Promise<number | null> {
    const cached = this.loadCached();
    if (cached !== null) return cached;
    const enabled = await this.checkTopicsEnabled();
    if (!enabled) return null;
    try {
      const threadId = await this.createOtpTopic();
      this.persistThreadId(threadId);
      getLogger().info(`  🔐 OTP topic created: thread #${threadId}`);
      return threadId;
    } catch (e: unknown) {
      getLogger().warn(`  ⚠️  Could not create OTP topic: ${errorMessage(e)}`);
      return null;
    }
  }

  private loadCached(): number | null {
    const path = join(this.cacheDir, CACHE_FILE);
    if (!existsSync(path)) return null;
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as OtpThreadCache;
      return typeof data.threadId === 'number' ? data.threadId : null;
    } catch { return null; }
  }

  private persistThreadId(id: number): void {
    try {
      mkdirSync(this.cacheDir, { recursive: true });
      writeFileSync(join(this.cacheDir, CACHE_FILE), JSON.stringify({ threadId: id }));
    } catch (e: unknown) {
      getLogger().warn(`  ⚠️  Could not persist OTP thread ID: ${errorMessage(e)}`);
    }
  }

  private async checkTopicsEnabled(): Promise<boolean> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/getChat?chat_id=${this.chatId}`;
    const resp = await fetch(url).catch(() => null);
    if (!resp?.ok) return false;
    const data = await resp.json() as { ok: boolean; result?: { has_topics_enabled?: boolean } };
    return data.ok && data.result?.has_topics_enabled === true;
  }

  private async createOtpTopic(): Promise<number> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/createForumTopic`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.chatId, name: OTP_TOPIC_NAME }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`createForumTopic failed: ${resp.status} ${body}`);
    }
    const data = await resp.json() as { ok: boolean; result?: { message_thread_id: number } };
    if (!data.ok || data.result?.message_thread_id === undefined) {
      throw new Error('createForumTopic: missing message_thread_id in response');
    }
    return data.result.message_thread_id;
  }
}
