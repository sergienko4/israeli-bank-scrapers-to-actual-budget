import { describe, it, expect, vi } from 'vitest';
import NetworkError from '../../src/Errors/NetworkError.js';
import TelegramUpdateDispatcher, { type TextHandler } from '../../src/Services/TelegramUpdateDispatcher.js';
import type TelegramPollHttp from '../../src/Services/TelegramPollHttp.js';
import type { ITelegramUpdate } from '../../src/Types/Index.js';
import { fail, succeed } from '../../src/Types/ProcedureHelpers.js';

const CHAT_ID = '999';
const STARTED_AT = 1_767_225_600;

/**
 * Builds a text-message update from the configured chat, sent after start.
 * @param updateId - Telegram update_id.
 * @param text - Message body.
 * @returns A message update the dispatcher accepts.
 */
function textUpdate(updateId: number, text: string): ITelegramUpdate {
  return { update_id: updateId, message: { chat: { id: 999 }, text, date: STARTED_AT + updateId } };
}

/**
 * Creates a dispatcher whose callback-query ACKs always succeed.
 * @param onText - Handler for message text and callback data.
 * @returns A dispatcher bound to CHAT_ID.
 */
function makeDispatcher(onText: TextHandler) {
  const http = {
    answerCallbackQuery: vi.fn().mockResolvedValue(succeed({ status: 'acked' })),
  } as unknown as TelegramPollHttp;
  return new TelegramUpdateDispatcher(http, { chatId: CHAT_ID, startedAt: STARTED_AT, onText });
}

describe('TelegramUpdateDispatcher.apply', () => {
  it('handles updates one at a time in order and returns the next offset', async () => {
    const log: string[] = [];
    const dispatcher = makeDispatcher(async text => {
      log.push(`start ${text}`);
      await new Promise<void>(resolve => { setImmediate(resolve); });
      log.push(`end ${text}`);
      return succeed({ status: 'handled' });
    });

    const result = await dispatcher.apply({
      ok: true,
      result: [textUpdate(41, '/scan'), textUpdate(42, '/status'), textUpdate(43, '/logs')],
    });

    expect(log).toEqual([
      'start /scan', 'end /scan', 'start /status', 'end /status', 'start /logs', 'end /logs',
    ]);
    expect(result).toEqual(succeed({ nextOffset: 44 }));
  });

  it('rejects on a failed handler and dispatches no later update', async () => {
    const handled: string[] = [];
    const dispatcher = makeDispatcher(text => {
      handled.push(text);
      if (text === '/status') return Promise.resolve(fail('status lookup failed'));
      return Promise.resolve(succeed({ status: 'handled' }));
    });

    const applying = dispatcher.apply({
      ok: true,
      result: [textUpdate(41, '/scan'), textUpdate(42, '/status'), textUpdate(43, '/logs')],
    });

    await expect(applying).rejects.toThrow(NetworkError);
    expect(handled).toEqual(['/scan', '/status']);
  });

  it('advances past updates it skips', async () => {
    const onText = vi.fn().mockResolvedValue(succeed({ status: 'handled' }));
    const dispatcher = makeDispatcher(onText);
    const fromOtherChat: ITelegramUpdate = {
      update_id: 77, message: { chat: { id: 888 }, text: '/scan', date: STARTED_AT + 77 },
    };

    const result = await dispatcher.apply({ ok: true, result: [textUpdate(76, '/scan'), fromOtherChat] });

    expect(onText).toHaveBeenCalledTimes(1);
    expect(result).toEqual(succeed({ nextOffset: 78 }));
  });
});
