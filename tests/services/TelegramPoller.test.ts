import { describe, it, expect, vi, beforeEach } from 'vitest';
import TelegramPoller from '../../src/Services/TelegramPoller.js';
import * as LoggerModule from '../../src/Logger/Index.js';

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

const emptyResponse = () => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({ ok: true, result: [] })
});

describe('TelegramPoller', () => {
  let fetchMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(LoggerModule, 'getLogger').mockReturnValue(mockLogger as any);
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
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Network failure')
    );
  });

  it('skips update when poll response.ok is false', async () => {
    vi.useFakeTimers();
    try {
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
      const startPromise = poller.start();
      await vi.advanceTimersByTimeAsync(5001);
      await startPromise;
      expect(onMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
            result: [{ update_id: 1, message: {
              chat: { id: 999 }, date: Math.floor(Date.now() / 1000)
            } }]
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

  it('stop() aborts in-flight poll immediately', async () => {
    const poller = new TelegramPoller('123:ABC', '999', vi.fn());
    let abortSignal: AbortSignal | undefined;

    let callCount = 0;
    fetchMock.mockImplementation((_url: string, opts?: RequestInit) => {
      callCount++;
      if (callCount === 1) return emptyResponse(); // clearOldMessages
      abortSignal = opts?.signal as AbortSignal | undefined;
      // Simulate a long-running fetch that never resolves on its own
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });

    const startPromise = poller.start();
    // Wait for the long-poll to begin
    await new Promise(r => setTimeout(r, 10));
    poller.stop();
    await startPromise;

    expect(abortSignal?.aborted).toBe(true);
  });

  it('dispatches callback_query data and answers the callback', async () => {
    const onMessage = vi.fn().mockResolvedValue(undefined);
    const poller = new TelegramPoller('123:ABC', '999', onMessage);

    let callCount = 0;
    fetchMock.mockImplementation((...args: unknown[]) => {
      callCount++;
      if (callCount <= 1) return emptyResponse();
      if (callCount === 2) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            result: [{
              update_id: 5,
              callback_query: {
                id: 'cb-123',
                data: 'scan:discount',
                message: { chat: { id: 999 } },
              },
            }],
          }),
        });
      }
      // call 3 = answerCallbackQuery POST
      if (callCount === 3) {
        return Promise.resolve({ ok: true });
      }
      poller.stop();
      return emptyResponse();
    });

    await poller.start();
    expect(onMessage).toHaveBeenCalledWith('scan:discount');
    const answerUrl = fetchMock.mock.calls[2]?.[0] ?? '';
    expect(answerUrl).toContain('answerCallbackQuery');
  });

  it('dispatches photo messages to onPhoto handler', async () => {
    const onMessage = vi.fn().mockResolvedValue(undefined);
    const onPhoto = vi.fn().mockResolvedValue(undefined);
    const poller = new TelegramPoller('123:ABC', '999', onMessage);
    poller.setPhotoHandler(onPhoto);

    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) return emptyResponse();
      if (callCount === 2) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            result: [{
              update_id: 200,
              message: {
                chat: { id: 999 },
                date: Math.floor(Date.now() / 1000) + 10,
                photo: [
                  { file_id: 'small', file_unique_id: 's1', width: 90, height: 90 },
                  { file_id: 'large', file_unique_id: 'l1', width: 800, height: 600 },
                ],
                caption: 'my receipt',
              },
            }],
          }),
        });
      }
      poller.stop();
      return emptyResponse();
    });

    await poller.start();
    expect(onPhoto).toHaveBeenCalledWith('large', 'my receipt');
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('ignores photo messages when no onPhoto handler set', async () => {
    const onMessage = vi.fn().mockResolvedValue(undefined);
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
            result: [{
              update_id: 201,
              message: {
                chat: { id: 999 },
                date: Math.floor(Date.now() / 1000) + 10,
                photo: [{ file_id: 'f1', file_unique_id: 'u1', width: 100, height: 100 }],
              },
            }],
          }),
        });
      }
      poller.stop();
      return emptyResponse();
    });

    await poller.start();
    expect(onMessage).not.toHaveBeenCalled();
  });

  describe('stopAndFlush', () => {
    it('confirms processed updates with a final getUpdates call', async () => {
      const poller = new TelegramPoller('123:ABC', '999', vi.fn().mockResolvedValue(undefined));

      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // clearOldMessages → offset becomes 51
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ok: true, result: [{ update_id: 50 }] }),
          });
        }
        if (callCount === 2) {
          // first poll → delivers a message, offset becomes 52
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              result: [{ update_id: 51, message: { chat: { id: 999 }, text: '/help', date: Date.now() } }],
            }),
          });
        }
        // call 3+ = next poll → stop, or flush call
        poller.stop();
        return emptyResponse();
      });

      await poller.start();
      const callsBefore = fetchMock.mock.calls.length;
      await poller.stopAndFlush();

      const flushUrl: string = fetchMock.mock.calls[callsBefore]?.[0] ?? '';
      expect(flushUrl).toContain('getUpdates');
      expect(flushUrl).toContain('offset=52');
      expect(flushUrl).toContain('timeout=0');
    });

    it('skips flush when offset is 0 (no updates processed)', async () => {
      const poller = new TelegramPoller('123:ABC', '999', vi.fn());
      await poller.stopAndFlush();
      // Only stop() is called, no fetch for flush
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not throw when flush fetch fails', async () => {
      const poller = new TelegramPoller('123:ABC', '999', vi.fn().mockResolvedValue(undefined));

      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ok: true, result: [{ update_id: 10 }] }),
          });
        }
        poller.stop();
        return emptyResponse();
      });

      await poller.start();
      fetchMock.mockRejectedValue(new Error('Network error'));
      const flushResult = await poller.stopAndFlush();
      expect(flushResult.success).toBe(true);
    });

    it('is idempotent — calling twice does not throw', async () => {
      const poller = new TelegramPoller('123:ABC', '999', vi.fn().mockResolvedValue(undefined));

      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ok: true, result: [{ update_id: 5 }] }),
          });
        }
        poller.stop();
        return emptyResponse();
      });

      await poller.start();
      fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
      await poller.stopAndFlush();
      const secondFlush = await poller.stopAndFlush();
      expect(secondFlush.success).toBe(true);
    });
  });
});
