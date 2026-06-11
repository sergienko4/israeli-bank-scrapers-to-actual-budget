import { describe, it, expect, vi, beforeEach } from 'vitest';

import type TelegramNotifier from '../../../src/Services/Notifications/TelegramNotifier.js';
import type { ITelegramConfig } from '../../../src/Types/Index.js';
import { succeed } from '../../../src/Types/ProcedureHelpers.js';

const { commandHandlerCtor } = vi.hoisted(() => ({
  commandHandlerCtor: vi.fn(),
}));

vi.mock('../../../src/Services/TelegramCommandHandler.js', () => {
  class MockTelegramCommandHandler {
    constructor(opts: unknown) { commandHandlerCtor(opts); }
  }
  return { TelegramCommandHandler: MockTelegramCommandHandler };
});

vi.mock('../../../src/Services/AuditLogService.js', () => {
  class MockAuditLogService {
    record = vi.fn();
  }
  return { AuditLogService: MockAuditLogService };
});

vi.mock('../../../src/Services/ReceiptImportHandler.js', () => {
  class MockReceiptImportHandler {
    constructor(_opts: unknown) { /* noop */ }
  }
  return { ReceiptImportHandler: MockReceiptImportHandler };
});

vi.mock('../../../src/Services/ReceiptOcrService.js', () => {
  class MockReceiptOcrService { /* noop */ }
  return { default: MockReceiptOcrService };
});

vi.mock('../../../src/Services/ReceiptApiAdapter.js', () => ({
  default: vi.fn(),
}));

vi.mock('../../../src/Scheduler/ConfigBootstrap.js', () => ({
  loadFullConfig: vi.fn(() => succeed({ banks: {} })),
  loadLogConfig: vi.fn(() => succeed({ logDir: '/var/log/import' })),
}));

import {
  buildCommandHandler, buildHandlerWithConfig,
} from '../../../src/Scheduler/Telegram/HandlerFactory.js';

const fakeNotifier = {
  sendMessage: vi.fn(),
  sendScanMenu: vi.fn(),
} as unknown as TelegramNotifier;

describe('HandlerFactory edge cases', () => {
  beforeEach(() => vi.clearAllMocks());

  it('buildCommandHandler with default options passes undefined logDir + no receipt handler', () => {
    const fakeMediator = { setPoller: vi.fn() } as never;
    buildCommandHandler(fakeNotifier, fakeMediator);
    expect(commandHandlerCtor).toHaveBeenCalledWith(
      expect.objectContaining({ logDir: undefined, receiptHandler: undefined })
    );
  });

  it('buildHandlerWithConfig forwards receipt flag from telegram config', () => {
    const fakeMediator = { setPoller: vi.fn() } as never;
    const tg = { enableReceiptImport: true } as ITelegramConfig;
    buildHandlerWithConfig(fakeNotifier, fakeMediator, tg);
    expect(commandHandlerCtor).toHaveBeenCalledWith(
      expect.objectContaining({ logDir: '/var/log/import' })
    );
  });
});
