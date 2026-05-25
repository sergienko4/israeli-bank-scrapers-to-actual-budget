import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isFail, isSuccess } from '../../src/Types/ProcedureHelpers.js';

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

import {
  loadFullConfig,
  loadLogConfig,
} from '../../src/Scheduler/ConfigBootstrap.js';

describe('ConfigBootstrap.loadFullConfig', () => {
  beforeEach(() => { vi.clearAllMocks(); mockLoadRaw.mockReset(); });

  it('delegates to ConfigLoader.loadRaw on success', () => {
    const fakeConfig = { banks: { leumi: {} } };
    mockLoadRaw.mockReturnValue({ success: true, data: fakeConfig });
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
});

describe('ConfigBootstrap.loadLogConfig', () => {
  beforeEach(() => { vi.clearAllMocks(); mockLoadRaw.mockReset(); });

  it('returns a success procedure with the default log dir when none is set', () => {
    mockLoadRaw.mockReturnValue({ success: true, data: { banks: {} } });
    const result = loadLogConfig();
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data.logDir).toBe('./logs');
  });

  it('honours explicit logDir from config when present', () => {
    mockLoadRaw.mockReturnValue({
      success: true,
      data: { banks: {}, logConfig: { format: 'json', logDir: '/var/logs/app' } },
    });
    const result = loadLogConfig();
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data.logDir).toBe('/var/logs/app');
  });

  it('returns failure when the underlying config cannot be loaded', () => {
    mockLoadRaw.mockReturnValue({ success: false, message: 'no file' });
    const result = loadLogConfig();
    expect(result.success).toBe(false);
    if (!isFail(result)) return;
    expect(result.message).toContain('Cannot derive log config');
  });
});
