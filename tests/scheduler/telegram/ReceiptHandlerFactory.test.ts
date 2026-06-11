import { describe, it, expect, vi, beforeEach } from 'vitest';

import type TelegramNotifier from '../../../src/Services/Notifications/TelegramNotifier.js';

const { receiptHandlerCtor, ocrCtor, apiFactoryFn } = vi.hoisted(() => ({
  receiptHandlerCtor: vi.fn(),
  ocrCtor: vi.fn(),
  apiFactoryFn: vi.fn(),
}));

vi.mock('../../../src/Services/ReceiptImportHandler.js', () => {
  class MockReceiptImportHandler {
    constructor(opts: unknown) { receiptHandlerCtor(opts); }
  }
  return { ReceiptImportHandler: MockReceiptImportHandler };
});

vi.mock('../../../src/Services/ReceiptOcrService.js', () => {
  class MockReceiptOcrService { constructor() { ocrCtor(); } }
  return { default: MockReceiptOcrService };
});

vi.mock('../../../src/Services/ReceiptApiAdapter.js', () => ({
  default: apiFactoryFn,
}));

import createReceiptHandler from '../../../src/Scheduler/Telegram/ReceiptHandlerFactory.js';

const fakeNotifier = {
  sendMessage: vi.fn(),
} as unknown as TelegramNotifier;

describe('ReceiptHandlerFactory edge cases', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false when receipt import is disabled', () => {
    const result = createReceiptHandler(fakeNotifier, false);
    expect(result).toBe(false);
    expect(receiptHandlerCtor).not.toHaveBeenCalled();
    expect(ocrCtor).not.toHaveBeenCalled();
  });

  it('builds the handler and wires OCR service when enabled', () => {
    const result = createReceiptHandler(fakeNotifier, true);
    expect(result).not.toBe(false);
    expect(receiptHandlerCtor).toHaveBeenCalledTimes(1);
    expect(ocrCtor).toHaveBeenCalledTimes(1);
  });

  it('wires the same notifier into both notifier and telegramNotifier slots', () => {
    createReceiptHandler(fakeNotifier, true);
    expect(receiptHandlerCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        notifier: fakeNotifier,
        telegramNotifier: fakeNotifier,
      })
    );
  });

  it('forwards the ReceiptApiAdapter as apiFactory', () => {
    createReceiptHandler(fakeNotifier, true);
    expect(receiptHandlerCtor).toHaveBeenCalledWith(
      expect.objectContaining({ apiFactory: apiFactoryFn })
    );
  });
});
