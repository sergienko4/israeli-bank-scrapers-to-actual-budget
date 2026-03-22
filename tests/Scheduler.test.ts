import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as childProcess from 'node:child_process';
import { succeed, fail, isFail, isSuccess } from '../src/Types/ProcedureHelpers.js';
import type { IImporterConfig } from '../src/Types/Index.js';
import type TelegramNotifier from '../src/Services/Notifications/TelegramNotifier.js';

// ── Logger mock via vi.hoisted (Scheduler.ts calls getLogger at module-load time) ─
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  getLogBuffer: vi.fn(),
  deriveLogFormat: vi.fn(() => 'words'),
}));

// ── fs mock ──────────────────────────────────────────────────────────────────
vi.mock('node:fs');

// ── child_process mock ───────────────────────────────────────────────────────
vi.mock('node:child_process');

// ── Config encryption mock (hoisted so we can change per-test) ──────────────
const { mockIsEncrypted, mockDecrypt, mockGetPassword, mockLoadRaw } = vi.hoisted(() => ({
  mockIsEncrypted: vi.fn(() => false),
  mockDecrypt: vi.fn(),
  mockGetPassword: vi.fn(() => undefined),
  mockLoadRaw: vi.fn(() => ({ success: false, message: 'no config (test default)' })),
}));
vi.mock('../src/Config/ConfigEncryption.js', () => ({
  isEncryptedConfig: mockIsEncrypted,
  decryptConfig: mockDecrypt,
  getEncryptionPassword: mockGetPassword,
}));

// ── ConfigLoader mock ───────────────────────────────────────────────────────
vi.mock('../src/Config/ConfigLoader.js', () => {
  class MockConfigLoader {
    loadRaw = mockLoadRaw;
  }
  return { ConfigLoader: MockConfigLoader };
});

// ── TelegramCommandHandler mock ──────────────────────────────────────────────
vi.mock('../src/Services/TelegramCommandHandler.js', () => {
  class MockTelegramCommandHandler {
    handle = vi.fn();
    constructor(_opts: unknown) { /* noop */ }
  }
  return { TelegramCommandHandler: MockTelegramCommandHandler };
});

// ── TelegramPoller mock ──────────────────────────────────────────────────────
vi.mock('../src/Services/TelegramPoller.js', () => ({
  default: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), stopAndFlush: vi.fn().mockResolvedValue(undefined) })),
}));

// ── AuditLogService mock ─────────────────────────────────────────────────────
vi.mock('../src/Services/AuditLogService.js', () => {
  class MockAuditLogService {
    record = vi.fn();
    getRecent = vi.fn(() => []);
  }
  return { AuditLogService: MockAuditLogService };
});

// ── Now import the scheduler exports after all mocks are set ─────────────────
import {
  readJsonOrEncrypted,
  loadFullConfig,
  loadLogConfig,
  spawnImport,
  logImportResult,
  logCommandCount,
  buildExtraCommands,
  safeSleep,
  createMediator,
  buildCommandHandler,
} from '../src/Scheduler.js';

type MockChildProcess = Partial<ReturnType<typeof childProcess.spawn>>;

/** Creates a minimal mock ChildProcess accepted by spawn's return type. */
function mockChild(overrides: MockChildProcess = {}): ReturnType<typeof childProcess.spawn> {
  return { on: vi.fn(), ...overrides } as unknown as ReturnType<typeof childProcess.spawn>;
}

// ─── readJsonOrEncrypted ─────────────────────────────────────────────────────

describe('readJsonOrEncrypted', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = readJsonOrEncrypted('/app/config.json');
    expect(result.success).toBe(false);
    if (!isFail(result)) return;
    expect(result.message).toContain('File not found');
  });

  it('parses and returns plain JSON when not encrypted', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ foo: 'bar' }));
    const result = readJsonOrEncrypted('/app/config.json');
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data).toEqual({ foo: 'bar' });
  });
});

// ─── loadFullConfig ──────────────────────────────────────────────────────────

describe('loadFullConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when config.json does not exist', () => {
    mockLoadRaw.mockReturnValue(fail('config.json not found'));
    const result = loadFullConfig();
    expect(result.success).toBe(false);
    if (!isFail(result)) return;
    expect(result.message).toContain('config.json not found');
  });

  it('merges config.json with credentials.json when both exist', () => {
    mockLoadRaw.mockReturnValue(succeed({ banks: {}, token: 'secret' }));
    const result = loadFullConfig();
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data).toMatchObject({ banks: {}, token: 'secret' });
  });

  it('returns only config when credentials.json does not exist', () => {
    mockLoadRaw.mockReturnValue(succeed({ banks: {} }));
    const result = loadFullConfig();
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data).toMatchObject({ banks: {} });
  });
});

// ─── loadLogConfig ───────────────────────────────────────────────────────────

describe('loadLogConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns undefined when config cannot be loaded', () => {
    mockLoadRaw.mockReturnValue(fail('config.json not found'));
    const result = loadLogConfig();
    expect(result.success).toBe(false);
    if (!isFail(result)) return;
    expect(result.message).toContain('Cannot derive log config');
  });

  it('returns logConfig with defaults when config is minimal', () => {
    mockLoadRaw.mockReturnValue(succeed({ actual: { init: {}, budget: {} }, banks: {} }));
    const result = loadLogConfig();
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data.logDir).toBe('./logs');
  });
});

// ─── spawnImport ─────────────────────────────────────────────────────────────

describe('spawnImport', () => {
  it('spawns node /app/dist/Index.js and returns a promise', () => {
    vi.mocked(childProcess.spawn).mockReturnValue(mockChild());
    const result = spawnImport();
    expect(result).toBeInstanceOf(Promise);
    expect(childProcess.spawn).toHaveBeenCalledWith(
      'node', ['/app/dist/Index.js'], expect.objectContaining({ stdio: 'inherit' })
    );
  });
});

// ─── createMediator ──────────────────────────────────────────────────────────

describe('createMediator', () => {
  it('returns an ImportMediator instance', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const mediator = createMediator(fail('no notifier'));
    expect(mediator).toBeDefined();
    expect(typeof mediator.requestImport).toBe('function');
    expect(typeof mediator.isImporting).toBe('function');
  });
});

// ─── logImportResult ─────────────────────────────────────────────────────────

describe('logImportResult', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs success when exit code is 0', () => {
    logImportResult(0, new Date(Date.now() - 5000));
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Import completed successfully')
    );
  });

  it('logs failure when exit code is non-zero', () => {
    logImportResult(1, new Date(Date.now() - 3000));
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Import failed with exit code 1')
    );
  });
});

// ─── logCommandCount ─────────────────────────────────────────────────────────

describe('logCommandCount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs 4 commands when no extras', () => {
    logCommandCount([]);
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('4 bot commands'));
  });

  it('logs 5 commands and names when 1 extra is provided', () => {
    logCommandCount([{ command: 'watch', description: 'Watch spending' }]);
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('5 bot commands'));
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('/watch'));
  });
});

// ─── buildExtraCommands ──────────────────────────────────────────────────────

describe('buildExtraCommands', () => {
  it('returns 3 default commands when config is null', () => {
    const cmds = buildExtraCommands({} as Partial<IImporterConfig> as IImporterConfig);
    expect(cmds).toHaveLength(3);
    expect(cmds.map(c => c.command)).toContain('retry');
    expect(cmds.map(c => c.command)).toContain('check_config');
    expect(cmds.map(c => c.command)).toContain('preview');
  });

  it('returns 4 commands when config has spendingWatch rules', () => {
    const config = { spendingWatch: [{ alertFromAmount: 100, numOfDayToCount: 7 }] } as Partial<IImporterConfig> as IImporterConfig;
    const cmds = buildExtraCommands(config);
    expect(cmds).toHaveLength(4);
    expect(cmds.map(c => c.command)).toContain('watch');
  });

  it('returns 3 commands when config has empty spendingWatch array', () => {
    const config = { spendingWatch: [] } as Partial<IImporterConfig> as IImporterConfig;
    const cmds = buildExtraCommands(config);
    expect(cmds).toHaveLength(3);
  });
});

// ─── safeSleep ───────────────────────────────────────────────────────────────

describe('safeSleep', () => {
  it('resolves after the specified duration', async () => {
    const result = await safeSleep(1);
    expect(result.success).toBe(true);
  });

  it('clamps duration to MAX_TIMEOUT_MS (2^31-1)', async () => {
    const mockSetTimeout = vi.fn().mockResolvedValue(undefined);
    vi.doMock('node:timers/promises', () => ({ setTimeout: mockSetTimeout }));

    // Re-import to pick up the doMock
    const { safeSleep: freshSafeSleep } = await import('../src/Scheduler.js');
    await freshSafeSleep(Number.MAX_SAFE_INTEGER);

    expect(mockSetTimeout).toHaveBeenCalledWith(2147483647);
    vi.doUnmock('node:timers/promises');
  });
});

// ─── readJsonOrEncrypted: encrypted config paths ────────────────────────────

describe('readJsonOrEncrypted (encrypted paths)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns parsed encrypted config when password is available', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ encrypted: true, version: 1 })
    );
    mockIsEncrypted.mockReturnValue(true);
    mockGetPassword.mockReturnValue('s3cret');
    mockDecrypt.mockReturnValue(JSON.stringify({ decrypted: 'data' }));

    const result = readJsonOrEncrypted('/app/config.json');
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data).toEqual({ decrypted: 'data' });
  });

  it('returns failure when encrypted but no password', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ encrypted: true, version: 1 })
    );
    mockIsEncrypted.mockReturnValue(true);
    mockGetPassword.mockReturnValue(undefined);

    const result = readJsonOrEncrypted('/app/config.json');
    expect(result.success).toBe(false);
    if (!isFail(result)) return;
    expect(result.message).toContain('Encryption password required');
  });
});

// ─── loadFullConfig: catch path ─────────────────────────────────────────────

describe('loadFullConfig (error handling)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns failure when JSON parsing throws', () => {
    mockLoadRaw.mockImplementation(() => { throw new SyntaxError('Unexpected token'); });
    const result = loadFullConfig();
    expect(result.success).toBe(false);
    if (!isFail(result)) return;
    expect(result.message).toContain('Failed to load config');
  });
});

// ─── loadLogConfig: telegram config paths ───────────────────────────────────

describe('loadLogConfig (telegram paths)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('derives format from telegram config when listenForCommands is true', () => {
    const config = {
      actual: { init: {}, budget: {} },
      banks: {},
      notifications: {
        enabled: true,
        telegram: { botToken: 'tok', chatId: '123', listenForCommands: true, messageFormat: 'emoji' },
      },
    };
    mockLoadRaw.mockReturnValue(succeed(config));
    const result = loadLogConfig();
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data.logDir).toBe('./logs');
  });

  it('uses logConfig.format when explicitly set in config', () => {
    const config = {
      actual: { init: {}, budget: {} },
      banks: {},
      logConfig: { format: 'json', logDir: '/var/log' },
    };
    mockLoadRaw.mockReturnValue(succeed(config));
    const result = loadLogConfig();
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data.format).toBe('json');
    expect(result.data.logDir).toBe('/var/log');
  });
});

// ─── spawnImport: exit and error handlers ───────────────────────────────────

describe('spawnImport (child process lifecycle)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves with exit code from child process', async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const capturingChild = mockChild({
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => { handlers[event] = cb; }) as MockChildProcess['on'],
    });
    vi.mocked(childProcess.spawn).mockReturnValue(capturingChild);

    const promise = spawnImport();
    handlers.exit(2);
    const code = await promise;
    expect(code).toBe(2);
  });

  it('resolves with 0 when exit code is null and no signal', async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const capturingChild = mockChild({
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => { handlers[event] = cb; }) as MockChildProcess['on'],
    });
    vi.mocked(childProcess.spawn).mockReturnValue(capturingChild);

    const promise = spawnImport();
    handlers.exit(null, null);
    const code = await promise;
    expect(code).toBe(0);
  });

  it('resolves with 1 and logs warning when killed by signal', async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const capturingChild = mockChild({
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => { handlers[event] = cb; }) as MockChildProcess['on'],
    });
    vi.mocked(childProcess.spawn).mockReturnValue(capturingChild);

    const promise = spawnImport();
    handlers.exit(null, 'SIGTERM');
    const code = await promise;
    expect(code).toBe(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Import killed by signal: SIGTERM')
    );
  });

  it('resolves with 1 when child process emits error', async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const capturingChild = mockChild({
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => { handlers[event] = cb; }) as MockChildProcess['on'],
    });
    vi.mocked(childProcess.spawn).mockReturnValue(capturingChild);

    const promise = spawnImport();
    handlers.error(new Error('spawn ENOENT'));
    const code = await promise;
    expect(code).toBe(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to start import')
    );
  });

  it('passes extra env variables when provided', () => {
    vi.mocked(childProcess.spawn).mockReturnValue(mockChild());

    spawnImport({ BANK_NAME: 'leumi' });
    expect(childProcess.spawn).toHaveBeenCalledWith(
      'node', ['/app/dist/Index.js'],
      expect.objectContaining({
        env: expect.objectContaining({ BANK_NAME: 'leumi' }),
      })
    );
  });
});

// ─── createMediator: with notifier ──────────────────────────────────────────

describe('createMediator (with notifier)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts a successful notifier procedure', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const fakeNotifier = { sendMessage: vi.fn() } as unknown as TelegramNotifier;
    const mediator = createMediator(succeed(fakeNotifier));
    expect(mediator).toBeDefined();
    expect(typeof mediator.requestImport).toBe('function');
  });
});

// ─── buildCommandHandler ────────────────────────────────────────────────────

describe('buildCommandHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a TelegramCommandHandler instance', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const fakeNotifier = { sendMessage: vi.fn(), registerCommands: vi.fn(), sendScanMenu: vi.fn() } as unknown as TelegramNotifier;
    const mediator = createMediator(fail('no notifier'));
    const handler = buildCommandHandler(fakeNotifier, mediator);
    expect(handler).toBeDefined();
    expect(typeof handler.handle).toBe('function');
  });
});
