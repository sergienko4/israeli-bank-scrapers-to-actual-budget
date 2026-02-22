/**
 * Telegram API helpers for E2E test verification and cleanup.
 */

const TELEGRAM_API = 'https://api.telegram.org';
const RATE_LIMIT_DELAY_MS = 1100;

export const HAS_TELEGRAM = !!(
  process.env.E2E_TELEGRAM_BOT_TOKEN && process.env.E2E_TELEGRAM_CHAT_ID
);

export function getTelegramConfig() {
  return {
    botToken: process.env.E2E_TELEGRAM_BOT_TOKEN!,
    chatId: process.env.E2E_TELEGRAM_CHAT_ID!,
  };
}

export async function deleteMessage(
  token: string, chatId: string, messageId: number
): Promise<void> {
  const url = `${TELEGRAM_API}/bot${token}/deleteMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
  } catch { /* ignore cleanup failures */ }
}

interface BotCommand {
  command: string;
  description: string;
}

export async function getMyCommands(token: string): Promise<BotCommand[]> {
  const url = `${TELEGRAM_API}/bot${token}/getMyCommands`;
  const res = await fetch(url);
  const data = await res.json() as { ok: boolean; result: BotCommand[] };
  return data.ok ? data.result : [];
}

export async function rateLimitDelay(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
}

/**
 * Capture message_id from TelegramNotifier.send() by wrapping global fetch.
 * Returns a collector that records message IDs for cleanup.
 */
export function createMessageCollector() {
  const messageIds: number[] = [];
  const originalFetch = globalThis.fetch;

  function startCapturing(): void {
    globalThis.fetch = async (input, init) => {
      const res = await originalFetch(input, init);
      if (String(input).includes('/sendMessage')) {
        try {
          const clone = res.clone();
          const data = await clone.json() as { ok: boolean; result?: { message_id: number } };
          if (data.ok && data.result?.message_id) {
            messageIds.push(data.result.message_id);
          }
        } catch { /* ignore parse errors */ }
      }
      return res;
    };
  }

  function stopCapturing(): void {
    globalThis.fetch = originalFetch;
  }

  return { messageIds, startCapturing, stopCapturing };
}

interface TelegramCleanupConfig {
  botToken: string;
  chatId: string;
}

export async function cleanupMessages(
  collector: ReturnType<typeof createMessageCollector>,
  config: TelegramCleanupConfig
): Promise<void> {
  collector.stopCapturing();
  for (const id of collector.messageIds) {
    await deleteMessage(config.botToken, config.chatId, id);
  }
  collector.messageIds.length = 0;
  await rateLimitDelay();
}
