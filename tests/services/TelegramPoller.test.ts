import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramPoller } from '../../src/services/TelegramPoller.js';

const emptyResponse = () => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({ ok: true, result: [] })
});

describe('TelegramPoller', () => {
  let fetchMock: any;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // Call sequence: 1=clearOldMessages, 2=registerCommands, 3+=poll cycles

  it('dispatches messages from correct chatId', async () => {
    const onMessage = vi.fn().mockResolvedValue(undefined);
    const poller = new TelegramPoller('123:ABC', '999', onMessage);

    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) return emptyResponse(); // clearOld + registerCommands
      if (callCount === 3) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            result: [{ update_id: 1, message: { chat: { id: 999 }, text: '/scan' } }]
          })
        });
      }
      poller.stop();
      return emptyResponse();
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
      if (callCount <= 2) return emptyResponse();
      if (callCount === 3) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            result: [{ update_id: 1, message: { chat: { id: 888 }, text: '/scan' } }]
          })
        });
      }
      poller.stop();
      return emptyResponse();
    });

    await poller.start();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('clears old messages on start', async () => {
    const poller = new TelegramPoller('123:ABC', '999', vi.fn());

    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // clearOldMessages returns last update
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            result: [{ update_id: 100 }]
          })
        });
      }
      if (callCount === 2) return emptyResponse(); // registerCommands
      poller.stop();
      return emptyResponse();
    });

    await poller.start();

    // Third call (first poll) should use offset=101
    const thirdCallUrl = fetchMock.mock.calls[2]?.[0] ?? '';
    expect(thirdCallUrl).toContain('offset=101');
  });

  it('stops when stop() is called', async () => {
    const poller = new TelegramPoller('123:ABC', '999', vi.fn());

    fetchMock.mockImplementation(() => {
      poller.stop();
      return emptyResponse();
    });

    await poller.start();
  });

  it('registers bot commands on start', async () => {
    const poller = new TelegramPoller('123:ABC', '999', vi.fn());

    fetchMock.mockImplementation(() => {
      poller.stop();
      return emptyResponse();
    });

    await poller.start();

    const registerCall = fetchMock.mock.calls.find(
      (c: [string, ...unknown[]]) => typeof c[0] === 'string' && c[0].includes('setMyCommands')
    );
    expect(registerCall).toBeDefined();
  });
});
