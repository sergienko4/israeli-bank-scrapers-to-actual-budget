import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramPoller } from '../../src/services/TelegramPoller.js';

describe('TelegramPoller', () => {
  let fetchMock: any;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('dispatches messages from correct chatId', async () => {
    const onMessage = vi.fn().mockResolvedValue(undefined);
    const poller = new TelegramPoller('123:ABC', '999', onMessage);

    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            result: [{ update_id: 1, message: { chat: { id: 999 }, text: '/scan' } }]
          })
        });
      }
      poller.stop();
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: [] })
      });
    });

    await poller.start();
    expect(onMessage).toHaveBeenCalledWith('/scan');
  });

  it('ignores messages from wrong chatId', async () => {
    const onMessage = vi.fn();
    const poller = new TelegramPoller('123:ABC', '999', onMessage);

    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            result: [{ update_id: 1, message: { chat: { id: 888 }, text: '/scan' } }]
          })
        });
      }
      poller.stop();
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: [] })
      });
    });

    await poller.start();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('stops when stop() is called', async () => {
    const poller = new TelegramPoller('123:ABC', '999', vi.fn());

    fetchMock.mockImplementation(() => {
      poller.stop();
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: [] })
      });
    });

    await poller.start();
    // Completed without hanging
  });
});
