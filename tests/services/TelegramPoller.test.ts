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

  // Call sequence: 1=clearOldMessages, 2+=poll cycles

  it('dispatches messages from correct chatId', async () => {
    const onMessage = vi.fn().mockResolvedValue(undefined);
    const poller = new TelegramPoller('123:ABC', '999', onMessage);

    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) return emptyResponse(); // clearOld
      if (callCount === 2) {
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
      if (callCount <= 1) return emptyResponse();
      if (callCount === 2) {
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
      poller.stop();
      return emptyResponse();
    });

    await poller.start();

    // Second call (first poll) should use offset=101
    const secondCallUrl = fetchMock.mock.calls[1]?.[0] ?? '';
    expect(secondCallUrl).toContain('offset=101');
  });

  it('stops when stop() is called', async () => {
    const poller = new TelegramPoller('123:ABC', '999', vi.fn());

    fetchMock.mockImplementation(() => {
      poller.stop();
      return emptyResponse();
    });

    await poller.start();
  });

  it('does not call setMyCommands on start (scheduler registers commands)', async () => {
    const poller = new TelegramPoller('123:ABC', '999', vi.fn());

    fetchMock.mockImplementation(() => {
      poller.stop();
      return emptyResponse();
    });

    await poller.start();

    const registerCall = fetchMock.mock.calls.find(
      (c: [string, ...unknown[]]) => typeof c[0] === 'string' && c[0].includes('setMyCommands')
    );
    expect(registerCall).toBeUndefined();
  });

  it('logs error and retries when poll throws', async () => {
    vi.useFakeTimers();
    try {
      const poller = new TelegramPoller('123:ABC', '999', vi.fn());
      let callCount = 0;
      fetchMock.mockImplementation(async () => {
        callCount++;
        if (callCount <= 1) return emptyResponse();
        if (callCount === 2) throw new Error('Network failure');
        poller.stop();
        return emptyResponse();
      });
      const startPromise = poller.start();
      await vi.advanceTimersByTimeAsync(5001);
      await startPromise;
    } finally {
      vi.useRealTimers();
    }
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Network failure'));
  });

  it('skips update when poll response.ok is false', async () => {
    const onMessage = vi.fn();
    const poller = new TelegramPoller('123:ABC', '999', onMessage);
    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) return emptyResponse();
      if (callCount === 2) return Promise.resolve({ ok: false });
      poller.stop();
      return emptyResponse();
    });
    await poller.start();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('handles clearOldMessages fetch exception gracefully', async () => {
    const poller = new TelegramPoller('123:ABC', '999', vi.fn());
    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('DNS fail'));
      poller.stop();
      return emptyResponse();
    });
    await poller.start();
  });

  it('handles clearOldMessages non-ok response gracefully', async () => {
    const poller = new TelegramPoller('123:ABC', '999', vi.fn());
    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ ok: false });
      poller.stop();
      return emptyResponse();
    });
    await poller.start();
    const secondCallUrl = fetchMock.mock.calls[1]?.[0] ?? '';
    expect(secondCallUrl).toContain('offset=0');
  });

  it('ignores message with undefined text field', async () => {
    const onMessage = vi.fn();
    const poller = new TelegramPoller('123:ABC', '999', onMessage);
    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) return emptyResponse();
      if (callCount === 2) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            result: [{ update_id: 1, message: { chat: { id: 999 }, date: Math.floor(Date.now() / 1000) } }]
          })
        });
      }
      poller.stop();
      return emptyResponse();
    });
    await poller.start();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('ignores message with date before poller started', async () => {
    const onMessage = vi.fn();
    const poller = new TelegramPoller('123:ABC', '999', onMessage);
    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) return emptyResponse();
      if (callCount === 2) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            result: [{ update_id: 1, message: { chat: { id: 999 }, text: '/scan', date: 0 } }]
          })
        });
      }
      poller.stop();
      return emptyResponse();
    });
    await poller.start();
    expect(onMessage).not.toHaveBeenCalled();
  });
});
