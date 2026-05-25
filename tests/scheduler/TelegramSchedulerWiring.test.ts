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
    handlePhoto = vi.fn();
    constructor(_opts: unknown) { /* noop */ }
  }
  return { TelegramCommandHandler: MockTelegramCommandHandler };
});

const { mockRegisterCommands, mockNotifierCtor } = vi.hoisted(() => ({
  mockRegisterCommands: vi.fn(),
  mockNotifierCtor: vi.fn(),
}));
vi.mock('../../src/Services/Notifications/TelegramNotifier.js', () => {
  class MockTelegramNotifier {
    sendMessage = vi.fn();
    sendScanMenu = vi.fn(async () => undefined);
    registerCommands = mockRegisterCommands;
    constructor(opts: unknown) { mockNotifierCtor(opts); }
  }
  return { default: MockTelegramNotifier };
});

const { mockPollerStart } = vi.hoisted(() => ({
  mockPollerStart: vi.fn(async () => undefined),
}));
vi.mock('../../src/Services/TelegramPoller.js', () => {
  class MockTelegramPoller {
    start = mockPollerStart;
    setPhotoHandler = vi.fn();
    constructor(_token: string, _chatId: string, _handler: unknown) { /* noop */ }
  }
  return { default: MockTelegramPoller };
});

vi.mock('../../src/Services/ImportMediator.js', () => {
  class MockImportMediator {
    setPoller = vi.fn();
    requestImport = vi.fn(() => 'batch-1');
    waitForBatch = vi.fn(async () => ({ failureCount: 0 }));
    constructor(_opts: unknown) { /* noop */ }
  }
  return { ImportMediator: MockImportMediator };
});

import {
  buildExtraCommands,
  createReceiptHandler,
  getConfiguredBankNames,
  logCommandCount,
  startTelegramCommands,
} from '../../src/Scheduler/TelegramSchedulerWiring.js';

describe('TelegramSchedulerWiring.getConfiguredBankNames', () => {
  beforeEach(() => { vi.clearAllMocks(); mockLoadRaw.mockReset(); });

  it('returns bank names when config loads successfully', () => {
    mockLoadRaw.mockReturnValue(succeed({ banks: { leumi: {}, discount: {} } }));
    const names = getConfiguredBankNames();
    expect(names).toEqual(['leumi', 'discount']);
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

describe('TelegramSchedulerWiring.buildExtraCommands', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the three baseline commands when no optional features are configured', () => {
    const cfg = { banks: {} } as IImporterConfig;
    const extras = buildExtraCommands(cfg);
    expect(extras.map(c => c.command)).toEqual(['retry', 'check_config', 'preview']);
  });

  it('adds the watch command when spendingWatch is configured', () => {
    const cfg = {
      banks: {}, spendingWatch: [{ id: 'w1' }],
    } as unknown as IImporterConfig;
    const extras = buildExtraCommands(cfg);
    expect(extras.map(c => c.command)).toContain('watch');
  });

  it('adds the import_receipt command when receipt import is enabled', () => {
    const cfg = {
      banks: {},
      notifications: { telegram: { enableReceiptImport: true } },
    } as IImporterConfig;
    const extras = buildExtraCommands(cfg);
    expect(extras.map(c => c.command)).toContain('import_receipt');
  });
});

describe('TelegramSchedulerWiring.logCommandCount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs the total command count without extras suffix when none', () => {
    logCommandCount([]);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Registering 4 bot commands')
    );
  });

  it('lists extras when present', () => {
    logCommandCount([{ command: 'retry', description: 'r' }]);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('including /retry')
    );
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
    if (!isFail(result)) return;
    expect(result.message).toContain('Telegram commands not enabled');
  });

  it('succeeds and returns a mediator when listenForCommands is enabled', async () => {
    const cfg = {
      banks: { leumi: {} },
      notifications: {
        enabled: true,
        telegram: {
          botToken: 'tok', chatId: '42',
          listenForCommands: true, enableReceiptImport: false,
        },
      },
    } as unknown as IImporterConfig;
    mockLoadRaw.mockReturnValue(succeed(cfg));
    mockRegisterCommands.mockResolvedValue(succeed({ status: 'registered' }));

    const result = await startTelegramCommands();

    expect(result.success).toBe(true);
    expect(mockRegisterCommands).toHaveBeenCalledTimes(1);
    expect(mockPollerStart).toHaveBeenCalledTimes(1);
  });

  it('fails gracefully when registerCommands rejects', async () => {
    const cfg = {
      banks: {},
      notifications: {
        enabled: true,
        telegram: { botToken: 'tok', chatId: '42', listenForCommands: true },
      },
    } as unknown as IImporterConfig;
    mockLoadRaw.mockReturnValue(succeed(cfg));
    mockRegisterCommands.mockResolvedValue(fail('telegram-api-down'));

    const result = await startTelegramCommands();

    expect(result.success).toBe(false);
    if (!isFail(result)) return;
    expect(result.message).toContain('Telegram command startup failed');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to start Telegram commands')
    );
  });
});
