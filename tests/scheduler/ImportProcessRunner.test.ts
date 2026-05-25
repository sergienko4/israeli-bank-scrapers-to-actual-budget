import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  getLogBuffer: vi.fn(),
  deriveLogFormat: vi.fn(() => 'words'),
}));

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
vi.mock('node:child_process', async () => {
  const actual =
    await vi.importActual<typeof import('node:child_process')>(
      'node:child_process'
    );
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) =>
      mockSpawn.getMockImplementation()
        ? mockSpawn(...args)
        : actual.spawn(...args),
  };
});

import {
  logImportResult,
  spawnImport,
} from '../../src/Scheduler/ImportProcessRunner.js';

const CHILD_EXIT_ZERO = fileURLToPath(
  new URL('./fixtures/childExitZero.cjs', import.meta.url)
);

describe('ImportProcessRunner.logImportResult', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs a success line when the child exits with code 0', () => {
    const startTime = new Date(Date.now() - 1000);
    const result = logImportResult(0, startTime);
    expect(result.success).toBe(true);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Import completed successfully')
    );
  });

  it('logs an error line when the child exits with a non-zero code', () => {
    const startTime = new Date(Date.now() - 1000);
    const result = logImportResult(1, startTime);
    expect(result.success).toBe(true);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Import failed with exit code 1')
    );
  });
});

describe('ImportProcessRunner.spawnImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn.mockReset();
    delete process.env.IMPORT_CHILD_ENTRY;
  });

  it('resolves with the child exit code when the child exits cleanly', async () => {
    process.env.IMPORT_CHILD_ENTRY = CHILD_EXIT_ZERO;
    const code = await spawnImport();
    expect(code).toBe(0);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Import completed successfully')
    );
  });

  it('resolves with code 1 and logs the failure when the child emits an error event', async () => {
    const child = new EventEmitter() as EventEmitter & { stdio?: unknown };
    mockSpawn.mockImplementation(() => child);
    const pending = spawnImport({ EXTRA: '1' });
    setImmediate(() => child.emit('error', new Error('spawn ENOENT')));
    const code = await pending;
    expect(code).toBe(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to start import: spawn ENOENT')
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Import failed with exit code 1')
    );
  });

  it('treats termination by signal as a failed exit', async () => {
    const child = new EventEmitter() as EventEmitter & { stdio?: unknown };
    mockSpawn.mockImplementation(() => child);
    const pending = spawnImport();
    setImmediate(() => child.emit('exit', null, 'SIGTERM'));
    const code = await pending;
    expect(code).toBe(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Import killed by signal: SIGTERM')
    );
  });
});
