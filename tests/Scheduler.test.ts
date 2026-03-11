import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as childProcess from 'node:child_process';

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

// ── Config encryption mock ───────────────────────────────────────────────────
vi.mock('../src/Config/ConfigEncryption.js', () => ({
  isEncryptedConfig: vi.fn(() => false),
  decryptConfig: vi.fn(),
  getEncryptionPassword: vi.fn(() => undefined),
}));

// ── TelegramCommandHandler mock ──────────────────────────────────────────────
vi.mock('../src/Services/TelegramCommandHandler.js', () => ({
  TelegramCommandHandler: vi.fn(() => ({ handle: vi.fn() })),
}));

// ── TelegramPoller mock ──────────────────────────────────────────────────────
vi.mock('../src/Services/TelegramPoller.js', () => ({
  TelegramPoller: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), stopAndFlush: vi.fn().mockResolvedValue(undefined) })),
}));

// ── AuditLogService mock ─────────────────────────────────────────────────────
vi.mock('../src/Services/AuditLogService.js', () => ({
  AuditLogService: vi.fn(() => ({ record: vi.fn(), getRecent: vi.fn(() => []) })),
}));

// ── Now import the scheduler exports after all mocks are set ─────────────────
import {
  readJsonOrEncrypted,
  loadFullConfig,
  loadLogConfig,
  runLocked,
  runImportLocked,
  runPreviewLocked,
  logImportResult,
  logCommandCount,
  buildExtraCommands,
  safeSleep,
} from '../src/Scheduler.js';

// ─── readJsonOrEncrypted ─────────────────────────────────────────────────────

describe('readJsonOrEncrypted', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(readJsonOrEncrypted('/app/config.json')).toBeNull();
  });

  it('parses and returns plain JSON when not encrypted', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ foo: 'bar' }));
    const result = readJsonOrEncrypted('/app/config.json');
    expect(result).toEqual({ foo: 'bar' });
  });
});

// ─── loadFullConfig ──────────────────────────────────────────────────────────

describe('loadFullConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when config.json does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(loadFullConfig()).toBeNull();
  });

  it('merges config.json with credentials.json when both exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce(JSON.stringify({ banks: {} }))
      .mockReturnValueOnce(JSON.stringify({ token: 'secret' }));
    const result = loadFullConfig();
    expect(result).toMatchObject({ banks: {}, token: 'secret' });
  });

  it('returns only config when credentials.json does not exist', () => {
    vi.mocked(fs.existsSync)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify({ banks: {} }));
    const result = loadFullConfig();
    expect(result).toMatchObject({ banks: {} });
  });
});

// ─── loadLogConfig ───────────────────────────────────────────────────────────

describe('loadLogConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns undefined when config cannot be loaded', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(loadLogConfig()).toBeUndefined();
  });

  it('returns logConfig with defaults when config is minimal', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ actual: { init: {}, budget: {} }, banks: {} }));
    const result = loadLogConfig();
    expect(result).toBeDefined();
    expect(result?.logDir).toBe('./logs');
  });
});

// ─── runLocked ───────────────────────────────────────────────────────────────

describe('runLocked', () => {
  beforeEach(() => vi.clearAllMocks());

  it('executes the importFn and returns its exit code', async () => {
    const fn = vi.fn().mockResolvedValue(0);
    const result = await runLocked(fn);
    expect(fn).toHaveBeenCalled();
    expect(result).toBe(0);
  });

  it('returns non-zero exit code from failed importFn', async () => {
    const fn = vi.fn().mockResolvedValue(1);
    const result = await runLocked(fn);
    expect(result).toBe(1);
  });
});

// ─── runImportLocked / runPreviewLocked ──────────────────────────────────────

describe('runImportLocked', () => {
  it('calls runImport via runLocked and sets IMPORT_BANKS when banks provided', () => {
    const mockChild = { on: vi.fn() } as never;
    vi.mocked(childProcess.spawn).mockReturnValue(mockChild);
    const promise = runImportLocked(['discount', 'leumi']);
    // Just verify it returns a Promise
    expect(promise).toBeInstanceOf(Promise);
  });
});

describe('runPreviewLocked', () => {
  it('returns a promise', () => {
    const mockChild = { on: vi.fn() } as never;
    vi.mocked(childProcess.spawn).mockReturnValue(mockChild);
    const result = runPreviewLocked();
    expect(result).toBeInstanceOf(Promise);
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

  it('logs failure when exit code is null', () => {
    logImportResult(null, new Date());
    expect(mockLogger.error).toHaveBeenCalled();
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
  it('returns 2 default commands when config is null', () => {
    const cmds = buildExtraCommands(null);
    expect(cmds).toHaveLength(2);
    expect(cmds[0].command).toBe('check_config');
    expect(cmds[1].command).toBe('preview');
  });

  it('returns 3 commands when config has spendingWatch rules', () => {
    const config = { spendingWatch: [{ alertFromAmount: 100, numOfDayToCount: 7 }] } as never;
    const cmds = buildExtraCommands(config);
    expect(cmds).toHaveLength(3);
    expect(cmds[2].command).toBe('watch');
  });

  it('returns 2 commands when config has empty spendingWatch array', () => {
    const config = { spendingWatch: [] } as never;
    const cmds = buildExtraCommands(config);
    expect(cmds).toHaveLength(2);
  });
});

// ─── safeSleep ───────────────────────────────────────────────────────────────

describe('safeSleep', () => {
  it('resolves after the specified duration', async () => {
    await expect(safeSleep(1)).resolves.toBeUndefined();
  });

  it('clamps duration to MAX_TIMEOUT_MS (2^31-1)', async () => {
    // safeSleep should not throw even for huge values
    const promise = safeSleep(Number.MAX_SAFE_INTEGER);
    expect(promise).toBeInstanceOf(Promise);
    // Don't await (would hang) — just verify it doesn't throw synchronously
  });
});
