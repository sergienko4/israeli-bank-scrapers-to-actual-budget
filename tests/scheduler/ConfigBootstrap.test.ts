import { describe, it, expect, vi, beforeEach } from 'vitest';

import { fail, isFail, isSuccess, succeed } from '../../src/Types/ProcedureHelpers.js';
import type { IImporterConfig } from '../../src/Types/Index.js';

const { mockLoadRaw } = vi.hoisted(() => ({
  mockLoadRaw: vi.fn(),
}));
vi.mock('../../src/Scheduler/Config/ConfigLoaderFactory.js', () => ({
  default: mockLoadRaw,
}));

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  getLogBuffer: vi.fn(),
  deriveLogFormat: vi.fn(() => 'words'),
}));

import {
  loadFullConfig,
  loadLogConfig,
} from '../../src/Scheduler/ConfigBootstrap.js';

describe('ConfigBootstrap.loadFullConfig', () => {
  beforeEach(() => { vi.clearAllMocks(); mockLoadRaw.mockReset(); });

  it('delegates to the injected loader on success', () => {
    const fakeConfig = { banks: { leumi: {} } };
    mockLoadRaw.mockReturnValue(succeed(fakeConfig));
    const result = loadFullConfig();
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data).toBe(fakeConfig);
  });

  it('wraps thrown loader errors in a failure procedure', () => {
    mockLoadRaw.mockImplementation(() => { throw new Error('boom'); });
    const result = loadFullConfig();
    expect(result.success).toBe(false);
    if (!isFail(result)) return;
    expect(result.message).toContain('Failed to load config');
  });

  it('honours a per-call loader override (DI seam)', () => {
    const overrideConfig = { banks: { discount: {} } } as unknown as IImporterConfig;
    const overrideLoader = vi.fn(() => succeed(overrideConfig));
    const result = loadFullConfig(overrideLoader);
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data).toBe(overrideConfig);
    expect(mockLoadRaw).not.toHaveBeenCalled();
    expect(overrideLoader).toHaveBeenCalledOnce();
  });
});

describe('ConfigBootstrap.loadLogConfig', () => {
  beforeEach(() => { vi.clearAllMocks(); mockLoadRaw.mockReset(); });

  it('returns a success procedure with the default log dir when none is set', () => {
    mockLoadRaw.mockReturnValue(succeed({ banks: {} }));
    const result = loadLogConfig();
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data.logDir).toBe('./logs');
  });

  it('honours explicit logDir from config when present', () => {
    mockLoadRaw.mockReturnValue(succeed({
      banks: {},
      logConfig: { format: 'json', logDir: '/var/logs/app' },
    }));
    const result = loadLogConfig();
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data.logDir).toBe('/var/logs/app');
  });

  it('returns failure when the underlying config cannot be loaded', () => {
    mockLoadRaw.mockReturnValue(fail('no file'));
    const result = loadLogConfig();
    expect(result.success).toBe(false);
    if (!isFail(result)) return;
    expect(result.message).toContain('Cannot derive log config');
  });
});
