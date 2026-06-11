import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { ITelegramConfig } from '../../../src/Types/Index.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  getLogBuffer: vi.fn(),
  deriveLogFormat: vi.fn(() => 'words'),
}));

const { pollerCtor, mockStart, mockSetPhotoHandler } = vi.hoisted(() => ({
  pollerCtor: vi.fn(),
  mockStart: vi.fn(async () => undefined),
  mockSetPhotoHandler: vi.fn(),
}));
vi.mock('../../../src/Services/TelegramPoller.js', () => {
  class MockTelegramPoller {
    start = mockStart;
    setPhotoHandler = mockSetPhotoHandler;
    constructor(token: string, chatId: string, handler: unknown) {
      pollerCtor({ token, chatId, handler });
    }
  }
  return { default: MockTelegramPoller };
});

import wireAndStartPoller from '../../../src/Scheduler/Telegram/PollerWiring.js';

const fakeHandler = {
  handle: vi.fn(),
  handlePhoto: vi.fn(),
} as never;

describe('PollerWiring edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStart.mockReset();
    mockStart.mockResolvedValue(undefined);
  });

  it('does NOT set photo handler when enableReceiptImport is false', () => {
    const mediator = { setPoller: vi.fn() } as never;
    const tg = {
      botToken: 't', chatId: 'c', enableReceiptImport: false,
    } as ITelegramConfig;
    wireAndStartPoller(tg, fakeHandler, mediator);
    expect(mockSetPhotoHandler).not.toHaveBeenCalled();
  });

  it('sets photo handler when enableReceiptImport is true', () => {
    const mediator = { setPoller: vi.fn() } as never;
    const tg = {
      botToken: 't', chatId: 'c', enableReceiptImport: true,
    } as ITelegramConfig;
    wireAndStartPoller(tg, fakeHandler, mediator);
    expect(mockSetPhotoHandler).toHaveBeenCalledTimes(1);
  });

  it('attaches the poller to the mediator', () => {
    const setPoller = vi.fn();
    const mediator = { setPoller } as never;
    const tg = { botToken: 't', chatId: 'c' } as ITelegramConfig;
    wireAndStartPoller(tg, fakeHandler, mediator);
    expect(setPoller).toHaveBeenCalledTimes(1);
  });

  it('logs an error when poller.start() rejects', async () => {
    const startError = new Error('telegram boom');
    const startPromise = Promise.reject(startError);
    mockStart.mockReturnValueOnce(startPromise);
    const mediator = { setPoller: vi.fn() } as never;
    const tg = { botToken: 't', chatId: 'c' } as ITelegramConfig;
    wireAndStartPoller(tg, fakeHandler, mediator);
    await startPromise.catch(() => undefined);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('telegram boom')
    );
  });

  it('returns a successful poller-started Procedure', () => {
    const mediator = { setPoller: vi.fn() } as never;
    const tg = { botToken: 't', chatId: 'c' } as ITelegramConfig;
    const result = wireAndStartPoller(tg, fakeHandler, mediator);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('poller-started');
  });
});
