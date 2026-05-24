import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { IImporterConfig } from '../../src/Types/Index.js';
import type TelegramNotifier from '../../src/Services/Notifications/TelegramNotifier.js';
import { fail, isFail, succeed } from '../../src/Types/ProcedureHelpers.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  getLogBuffer: vi.fn(),
  deriveLogFormat: vi.fn(() => 'words'),
}));

const { mockLoadRaw } = vi.hoisted(() => ({
  mockLoadRaw: vi.fn(),
}));
vi.mock('../../src/Config/ConfigLoader.js', () => {
  class MockConfigLoader {
    loadRaw = mockLoadRaw;
  }
  return { ConfigLoader: MockConfigLoader };
});

vi.mock('../../src/Services/AuditLogService.js', () => {
  class MockAuditLogService {
    record = vi.fn();
    getRecent = vi.fn(() => []);
  }
  return { AuditLogService: MockAuditLogService };
});

vi.mock('../../src/Services/TelegramCommandHandler.js', () => {
  class MockTelegramCommandHandler {
    handle = vi.fn();
    constructor(_opts: unknown) { /* noop */ }
  }
  return { TelegramCommandHandler: MockTelegramCommandHandler };
});

import {
  createReceiptHandler,
  getConfiguredBankNames,
  startTelegramCommands,
} from '../../src/Scheduler/TelegramSchedulerWiring.js';

describe('TelegramSchedulerWiring.getConfiguredBankNames', () => {
  beforeEach(() => { vi.clearAllMocks(); mockLoadRaw.mockReset(); });

  it('returns bank names when config loads successfully', () => {
    mockLoadRaw.mockReturnValue(succeed({ banks: { leumi: {}, discount: {} } }));
    const names = getConfiguredBankNames();
    expect(names).toEqual(expect.arrayContaining(['leumi', 'discount']));
  });

  it('returns empty array and logs warning when config fails', () => {
    mockLoadRaw.mockReturnValue(fail('config not found'));
    const names = getConfiguredBankNames();
    expect(names).toEqual([]);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('config load failed'));
  });
});

describe('TelegramSchedulerWiring.createReceiptHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false when receipt import is disabled', () => {
    const fakeNotifier = { sendMessage: vi.fn() } as unknown as TelegramNotifier;
    const result = createReceiptHandler(fakeNotifier, false);
    expect(result).toBe(false);
  });
});

describe('TelegramSchedulerWiring.startTelegramCommands', () => {
  beforeEach(() => { vi.clearAllMocks(); mockLoadRaw.mockReset(); });

  it('fails when config cannot be loaded', async () => {
    mockLoadRaw.mockReturnValue(fail('no config'));
    const result = await startTelegramCommands();
    expect(result.success).toBe(false);
    if (!isFail(result)) return;
    expect(result.message).toContain('Config not loaded');
  });

  it('fails when notifications are disabled', async () => {
    const cfg = { banks: {}, notifications: { enabled: false } } as IImporterConfig;
    mockLoadRaw.mockReturnValue(succeed(cfg));
    const result = await startTelegramCommands();
    expect(result.success).toBe(false);
    if (!isFail(result)) return;
    expect(result.message).toContain('Telegram commands not enabled');
  });

  it('fails when listenForCommands is false', async () => {
    const cfg = {
      banks: {},
      notifications: {
        enabled: true,
        telegram: { botToken: 'x', chatId: '1', listenForCommands: false },
      },
    } as IImporterConfig;
    mockLoadRaw.mockReturnValue(succeed(cfg));
    const result = await startTelegramCommands();
    expect(result.success).toBe(false);
  });
});
