import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import TelegramPoller from '../../src/Services/TelegramPoller.js';
import type { Procedure } from '../../src/Types/Index.js';
import { fail, succeed } from '../../src/Types/Index.js';

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
}));

const emptyResponse = () => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({ ok: true, result: [] })
});

describe('TelegramPoller', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
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

  it('runs one poll cycle at a time until stop() ends the loop', async () => {
    const poller = new TelegramPoller('123:ABC', '999', vi.fn());
    const finishPolls: (() => void)[] = [];
    fetchMock.mockImplementationOnce(emptyResponse).mockImplementation(
      () => new Promise((resolve) => { finishPolls.push(() => { resolve(emptyResponse()); }); })
    );

    const run = poller.start();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    finishPolls[0]();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    poller.stop();
    finishPolls[1]();
    const result = await run;

    expect(result).toMatchObject({ success: true, data: { status: 'stopped' } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('ends a superseded run after its in-flight cycle without polling again', async () => {
    const poller = new TelegramPoller('123:ABC', '999', vi.fn());
    const finishPolls: (() => void)[] = [];
    /** @returns A poll response that settles when the test finishes it. */
    const heldPoll = (): Promise<unknown> =>
      new Promise((resolve) => { finishPolls.push(() => { resolve(emptyResponse()); }); });
    fetchMock.mockImplementationOnce(emptyResponse).mockImplementationOnce(heldPoll)
      .mockImplementationOnce(emptyResponse).mockImplementation(heldPoll);
    let firstRunEnded = false;

    const firstRun = poller.start().then((result) => { firstRunEnded = true; return result; });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const secondRun = poller.start();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    finishPolls[0]();
    await vi.waitFor(() => expect(firstRunEnded).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(await firstRun).toMatchObject({ success: true, data: { status: 'stopped' } });
    poller.stop();
    finishPolls[1]();
    await secondRun;
  });

  it('waits the retry backoff after a failed cycle before polling again', async () => {
    vi.useFakeTimers();
    try {
      const poller = new TelegramPoller('123:ABC', '999', vi.fn());
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return emptyResponse();
        if (callCount === 2) return Promise.resolve({ ok: false, status: 500 });
        poller.stop();
        return emptyResponse();
      });
      const run = poller.start();
      await vi.advanceTimersByTimeAsync(4999);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await run;
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips the retry backoff when stop() arrives during the failing cycle', async () => {
    vi.useFakeTimers();
    try {
      const poller = new TelegramPoller('123:ABC', '999', vi.fn());
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return emptyResponse();
        poller.stop();
        return Promise.resolve({ ok: false, status: 500 });
      });
      let runEnded = false;
      const run = poller.start().then((result) => { runEnded = true; return result; });
      await vi.advanceTimersByTimeAsync(0);
      expect(runEnded).toBe(true);
      await run;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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

    const registerCall = fetchMock.mock.calls.find(call => {
      const url = call[0];
      return typeof url === 'string' && url.includes('setMyCommands');
    });
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
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Network failure')
    );
  });

  it('logs HTTP status code on poll error and retries', async () => {
    vi.useFakeTimers();
    try {
      const onMessage = vi.fn();
      const poller = new TelegramPoller('123:ABC', '999', onMessage);
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return emptyResponse();
        if (callCount === 2) return Promise.resolve({ ok: false, status: 500 });
        poller.stop();
        return emptyResponse();
      });
      const startPromise = poller.start();
      await vi.advanceTimersByTimeAsync(5001);
      await startPromise;
      expect(onMessage).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('HTTP 500')
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([401, 403, 409])('stops poller on fatal HTTP %i', async (status) => {
    const poller = new TelegramPoller('123:ABC', '999', vi.fn());
    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) return emptyResponse();
      return Promise.resolve({ ok: false, status });
    });
    await poller.start();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(`fatal error (HTTP ${String(status)})`)
    );
  });

  it('resets error count after a successful poll', async () => {
    vi.useFakeTimers();
    try {
      const poller = new TelegramPoller('123:ABC', '999', vi.fn());
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return emptyResponse();
        if (callCount === 2) return Promise.resolve({ ok: false, status: 502 });
        if (callCount === 3) return emptyResponse();
        if (callCount === 4) return Promise.resolve({ ok: false, status: 502 });
        poller.stop();
        return emptyResponse();
      });
      const startPromise = poller.start();
      await vi.advanceTimersByTimeAsync(5001);
      await vi.advanceTimersByTimeAsync(5001);
      await startPromise;
      const warnCalls = mockLogger.warn.mock.calls.filter(
        (c: string[]) => c[0].includes('HTTP 502')
      );
      expect(warnCalls).toHaveLength(2);
      expect(warnCalls[0][0]).toContain('1/60');
      expect(warnCalls[1][0]).toContain('1/60');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets consecutiveErrors on restart (stop → start lifecycle)', async () => {
    vi.useFakeTimers();
    try {
      const poller = new TelegramPoller('123:ABC', '999', vi.fn());
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return emptyResponse();
        if (callCount === 2) return Promise.resolve({ ok: false, status: 502 });
        poller.stop();
        return emptyResponse();
      });
      const firstRun = poller.start();
      await vi.advanceTimersByTimeAsync(5001);
      await firstRun;
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('1/60'));

      mockLogger.warn.mockClear();
      callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return emptyResponse();
        if (callCount === 2) return Promise.resolve({ ok: false, status: 503 });
        poller.stop();
        return emptyResponse();
      });
      const secondRun = poller.start();
      await vi.advanceTimersByTimeAsync(5001);
      await secondRun;
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('1/60'));
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
    fetchMock.mockImplementation(() => {
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

  it('stop() interrupts backoff sleep immediately', async () => {
    vi.useFakeTimers();
    try {
      const poller = new TelegramPoller('123:ABC', '999', vi.fn());
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return emptyResponse();
        return Promise.resolve({ ok: false, status: 500 });
      });
      const startPromise = poller.start();
      await vi.advanceTimersByTimeAsync(100);
      poller.stop();
      await vi.advanceTimersByTimeAsync(100);
      await startPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('new start() supersedes in-progress run (concurrent overlap)', async () => {
    vi.useFakeTimers();
    try {
      const poller = new TelegramPoller('123:ABC', '999', vi.fn());
      let callCount = 0;

      // First run: clearOld OK → poll returns 500 → enters backoff sleep
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return emptyResponse();
        return Promise.resolve({ ok: false, status: 500 });
      });
      const firstRun = poller.start();
      await vi.advanceTimersByTimeAsync(200);

      // Second run: overlaps while first is sleeping
      callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) return emptyResponse();
        poller.stop();
        return emptyResponse();
      });
      const secondRun = poller.start();
      await vi.advanceTimersByTimeAsync(200);

      const firstResult = await firstRun;
      const secondResult = await secondRun;
      expect(firstResult.success).toBe(true);
      expect(secondResult.success).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // A run is superseded when stopAndFlush() (the /scan import lifecycle) or a
  // newer start() replaces it while its cycle is still in flight. These tests
  // pin that the old run cannot change the state of the run that replaced it.
  describe('superseded run isolation', () => {
    /** A long poll the test settles by hand. */
    interface IHeldPoll {
      /** The getUpdates URL the poller requested. */
      readonly url: string;
      /** The abort signal the poller sent with the request. */
      readonly signal: AbortSignal | undefined;
      /** Settles the poll with the given fetch response. */
      readonly settle: (response: unknown) => void;
    }

    /** @returns Resolves once every promise chain not waiting on a timer settles. */
    const flushAsyncWork = (): Promise<unknown> => vi.advanceTimersByTimeAsync(0);

    /** @returns The current fake-clock time in Telegram's whole-second format. */
    const nowSeconds = (): number => Math.floor(Date.now() / 1000);

    /** @returns A successful getUpdates response carrying the given updates. */
    const updatesResponse = (result: unknown[]): unknown => ({
      ok: true, json: () => Promise.resolve({ ok: true, result }),
    });

    /** @returns A getUpdates response failing with the given HTTP status. */
    const httpErrorResponse = (status: number): unknown => ({ ok: false, status });

    /** @returns A /scan command from the configured chat, sent after the run started. */
    const scanUpdate = (updateId: number): unknown => ({
      update_id: updateId,
      message: { chat: { id: 999 }, text: '/scan', date: nowSeconds() + 10 },
    });

    /**
     * Fakes the getUpdates endpoint: the offset=-1 probe returns the configured
     * last update, a timeout=0 flush returns nothing, and every long poll is
     * held until the test settles it.
     *
     * @returns The held polls and a setter for the probe's last update id.
     */
    const fakeTelegram = (): {
      polls: IHeldPoll[]; setLastUpdateId: (id: number) => void;
    } => {
      const polls: IHeldPoll[] = [];
      let lastUpdateId: number | undefined;
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('offset=-1')) {
          const result = lastUpdateId === undefined ? [] : [{ update_id: lastUpdateId }];
          return Promise.resolve(updatesResponse(result));
        }
        if (url.includes('timeout=0')) return Promise.resolve(updatesResponse([]));
        return new Promise((resolve) => {
          polls.push({ url, signal: init?.signal ?? undefined, settle: resolve });
        });
      });
      return { polls, setLastUpdateId: (id) => { lastUpdateId = id; } };
    };

    /**
     * A text handler whose replies the test releases, like the /scan handler
     * that waits for its import batch.
     *
     * @returns The handler and the pending reply resolvers, in call order.
     */
    const heldHandler = (): {
      onMessage: (text: string) => Promise<Procedure<{ status: string }>>;
      replies: ((reply: Procedure<{ status: string }>) => void)[];
    } => {
      const replies: ((reply: Procedure<{ status: string }>) => void)[] = [];
      const onMessage = vi.fn(() => new Promise<Procedure<{ status: string }>>(
        (resolve) => { replies.push(resolve); }
      ));
      return { onMessage, replies };
    };

    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('keeps the current run polling when a superseded run gets a fatal HTTP error', async () => {
      const telegram = fakeTelegram();
      const poller = new TelegramPoller('123:ABC', '999', vi.fn());
      const firstRun = poller.start();
      await flushAsyncWork();
      const secondRun = poller.start();
      await flushAsyncWork();

      telegram.polls[0].settle(httpErrorResponse(409));
      await flushAsyncWork();
      telegram.polls[1].settle(updatesResponse([]));
      await flushAsyncWork();

      expect(telegram.polls).toHaveLength(3);
      poller.stop();
      telegram.polls[2]?.settle(updatesResponse([]));
      await Promise.all([firstRun, secondRun]);
    });

    it('lets stop() interrupt the current run backoff after a superseded run handler fails', async () => {
      const telegram = fakeTelegram();
      const handler = heldHandler();
      const poller = new TelegramPoller('123:ABC', '999', handler.onMessage);
      const firstRun = poller.start();
      await flushAsyncWork();
      telegram.polls[0].settle(updatesResponse([scanUpdate(42)]));
      await flushAsyncWork();
      await poller.stopAndFlush();
      let secondRunEnded = false;
      const secondRun = poller.start().then((result) => { secondRunEnded = true; return result; });
      await flushAsyncWork();
      telegram.polls[1].settle(httpErrorResponse(500));
      await flushAsyncWork();
      handler.replies[0](fail('import failed'));
      await flushAsyncWork();

      poller.stop();
      await flushAsyncWork();

      expect(secondRunEnded).toBe(true);
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.all([firstRun, secondRun]);
    });

    it('lets stop() abort the current run poll after a superseded run poll settles', async () => {
      const telegram = fakeTelegram();
      const poller = new TelegramPoller('123:ABC', '999', vi.fn());
      const firstRun = poller.start();
      await flushAsyncWork();
      const secondRun = poller.start();
      await flushAsyncWork();
      telegram.polls[0].settle(updatesResponse([]));
      await firstRun;

      poller.stop();

      expect(telegram.polls[1].signal?.aborted).toBe(true);
      telegram.polls[1].settle(updatesResponse([]));
      await secondRun;
    });

    it('keeps the current run offset when a superseded run finishes its dispatch later', async () => {
      const telegram = fakeTelegram();
      const handler = heldHandler();
      const poller = new TelegramPoller('123:ABC', '999', handler.onMessage);
      telegram.setLastUpdateId(40);
      const firstRun = poller.start();
      await flushAsyncWork();
      telegram.polls[0].settle(updatesResponse([scanUpdate(42)]));
      await flushAsyncWork();
      await poller.stopAndFlush();
      telegram.setLastUpdateId(100);
      const secondRun = poller.start();
      await flushAsyncWork();

      handler.replies[0](succeed({ status: 'imported' }));
      await firstRun;
      telegram.polls[1].settle(updatesResponse([]));
      await flushAsyncWork();

      expect(telegram.polls[2]?.url).toContain('offset=101');
      poller.stop();
      telegram.polls[2]?.settle(updatesResponse([]));
      await secondRun;
    });

    it('keeps the current run offset when a superseded run offset probe answers late', async () => {
      const telegram = fakeTelegram();
      const probeAnswers: ((response: unknown) => void)[] = [];
      fetchMock.mockImplementationOnce(
        () => new Promise((resolve) => { probeAnswers.push(resolve); })
      );
      const poller = new TelegramPoller('123:ABC', '999', vi.fn());
      const firstRun = poller.start();
      await flushAsyncWork();
      telegram.setLastUpdateId(100);
      const secondRun = poller.start();
      await flushAsyncWork();

      probeAnswers[0](updatesResponse([{ update_id: 40 }]));
      await firstRun;
      telegram.polls[0].settle(updatesResponse([]));
      await flushAsyncWork();

      expect(telegram.polls[1]?.url).toContain('offset=101');
      poller.stop();
      telegram.polls[1]?.settle(updatesResponse([]));
      await secondRun;
    });

    it('keeps the current run error count when a superseded run dispatch succeeds', async () => {
      const telegram = fakeTelegram();
      const handler = heldHandler();
      const poller = new TelegramPoller('123:ABC', '999', handler.onMessage);
      const firstRun = poller.start();
      await flushAsyncWork();
      telegram.polls[0].settle(updatesResponse([scanUpdate(42)]));
      await flushAsyncWork();
      await poller.stopAndFlush();
      const secondRun = poller.start();
      await flushAsyncWork();
      telegram.polls[1].settle(httpErrorResponse(502));
      await flushAsyncWork();

      handler.replies[0](succeed({ status: 'imported' }));
      await firstRun;
      await vi.advanceTimersByTimeAsync(5000);
      telegram.polls[2]?.settle(httpErrorResponse(502));
      await flushAsyncWork();

      expect(mockLogger.warn).toHaveBeenLastCalledWith(
        expect.stringContaining('HTTP 502 (2/60)')
      );
      poller.stop();
      await flushAsyncWork();
      await secondRun;
    });

    it('dispatches a message a superseded run fetched before the current run started', async () => {
      const telegram = fakeTelegram();
      const onMessage = vi.fn().mockResolvedValue(undefined);
      const poller = new TelegramPoller('123:ABC', '999', onMessage);
      const firstRun = poller.start();
      await flushAsyncWork();
      const sentAt = nowSeconds() + 30;
      vi.setSystemTime(Date.now() + 60_000);
      const secondRun = poller.start();
      await flushAsyncWork();

      telegram.polls[0].settle(updatesResponse([{
        update_id: 42, message: { chat: { id: 999 }, text: '/balance', date: sentAt },
      }]));
      await firstRun;

      expect(onMessage).toHaveBeenCalledWith('/balance');
      poller.stop();
      telegram.polls[1].settle(updatesResponse([]));
      await secondRun;
    });

    it('ends a superseded run without a retry backoff when its handler fails', async () => {
      const telegram = fakeTelegram();
      const handler = heldHandler();
      const poller = new TelegramPoller('123:ABC', '999', handler.onMessage);
      let firstRunEnded = false;
      const firstRun = poller.start().then((result) => { firstRunEnded = true; return result; });
      await flushAsyncWork();
      telegram.polls[0].settle(updatesResponse([scanUpdate(42)]));
      await flushAsyncWork();
      await poller.stopAndFlush();
      const secondRun = poller.start();
      await flushAsyncWork();

      handler.replies[0](fail('import failed'));
      await flushAsyncWork();

      expect(firstRunEnded).toBe(true);
      poller.stop();
      telegram.polls[1].settle(updatesResponse([]));
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.all([firstRun, secondRun]);
    });

    it('logs a superseded run handler failure at debug instead of a retry warning', async () => {
      const telegram = fakeTelegram();
      const handler = heldHandler();
      const poller = new TelegramPoller('123:ABC', '999', handler.onMessage);
      const firstRun = poller.start();
      await flushAsyncWork();
      telegram.polls[0].settle(updatesResponse([scanUpdate(42)]));
      await flushAsyncWork();
      await poller.stopAndFlush();
      const secondRun = poller.start();
      await flushAsyncWork();

      handler.replies[0](fail('import failed'));
      await flushAsyncWork();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Telegram poll: superseded run ended (error: Telegram handler returned unsuccessful Procedure)'
      );
      expect(mockLogger.warn).not.toHaveBeenCalled();
      poller.stop();
      telegram.polls[1].settle(updatesResponse([]));
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.all([firstRun, secondRun]);
    });

    it('logs a superseded run late HTTP error at debug instead of a fatal stop', async () => {
      const telegram = fakeTelegram();
      const poller = new TelegramPoller('123:ABC', '999', vi.fn());
      const firstRun = poller.start();
      await flushAsyncWork();
      const secondRun = poller.start();
      await flushAsyncWork();

      telegram.polls[0].settle(httpErrorResponse(409));
      await firstRun;

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Telegram poll: superseded run ended (http-409)'
      );
      expect(mockLogger.error).not.toHaveBeenCalled();
      poller.stop();
      telegram.polls[1].settle(updatesResponse([]));
      await secondRun;
    });

    it('reports superseded when stopAndFlush() lands while start() clears old messages', async () => {
      const telegram = fakeTelegram();
      const probeAnswers: ((response: unknown) => void)[] = [];
      fetchMock.mockImplementationOnce(
        () => new Promise((resolve) => { probeAnswers.push(resolve); })
      );
      const poller = new TelegramPoller('123:ABC', '999', vi.fn());
      const run = poller.start();
      await flushAsyncWork();

      await poller.stopAndFlush();
      probeAnswers[0](updatesResponse([]));

      expect(await run).toMatchObject({ success: true, data: { status: 'superseded' } });
      expect(telegram.polls).toHaveLength(0);
    });
  });
});
