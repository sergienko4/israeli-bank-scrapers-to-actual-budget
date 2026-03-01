import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { OtpThreadManager } from '../../src/Services/OtpThreadManager.js';

vi.mock('../../src/Logger/index.js', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
  createLogger: vi.fn(),
  deriveLogFormat: vi.fn(),
}));

vi.mock('fs');

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('OtpThreadManager', () => {
  const TOKEN = 'test-token';
  const CHAT_ID = '12345';
  const CACHE_DIR = '/tmp/test-cache';

  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockReturnValue('{}');
    vi.mocked(mkdirSync).mockReturnValue(undefined);
    vi.mocked(writeFileSync).mockReturnValue(undefined);
  });

  afterEach(() => { vi.clearAllMocks(); });

  it('returns cached thread ID without calling API', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ threadId: 42 }));

    const manager = new OtpThreadManager(TOKEN, CHAT_ID, CACHE_DIR);
    const id = await manager.getOrCreateThreadId();

    expect(id).toBe(42);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null when Topics mode is not enabled', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { has_topics_enabled: false } }),
    });

    const manager = new OtpThreadManager(TOKEN, CHAT_ID, CACHE_DIR);
    const id = await manager.getOrCreateThreadId();

    expect(id).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('getChat'));
  });

  it('creates topic when Topics mode is enabled and caches the thread ID', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { has_topics_enabled: true } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_thread_id: 99 } }),
      });

    const manager = new OtpThreadManager(TOKEN, CHAT_ID, CACHE_DIR);
    const id = await manager.getOrCreateThreadId();

    expect(id).toBe(99);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(2, expect.stringContaining('createForumTopic'),
      expect.objectContaining({ method: 'POST' }));
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('otp-thread.json'),
      JSON.stringify({ threadId: 99 })
    );
  });

  it('returns null and warns when createForumTopic fails', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { has_topics_enabled: true } }),
      })
      .mockResolvedValueOnce({ ok: false, text: () => Promise.resolve('Bad Request') });

    const manager = new OtpThreadManager(TOKEN, CHAT_ID, CACHE_DIR);
    const id = await manager.getOrCreateThreadId();

    expect(id).toBeNull();
  });

  it('returns null when getChat request fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ ok: false }) });

    const manager = new OtpThreadManager(TOKEN, CHAT_ID, CACHE_DIR);
    const id = await manager.getOrCreateThreadId();

    expect(id).toBeNull();
  });
});
