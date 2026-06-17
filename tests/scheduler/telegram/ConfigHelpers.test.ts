import { describe, it, expect, vi, beforeEach } from 'vitest';

import { fail, succeed } from '../../../src/Types/ProcedureHelpers.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  getLogBuffer: vi.fn(),
  deriveLogFormat: vi.fn(() => 'words'),
}));

const { mockLoadFullConfig, mockValidateAll, mockFormatReport } = vi.hoisted(() => ({
  mockLoadFullConfig: vi.fn(),
  mockValidateAll: vi.fn(),
  mockFormatReport: vi.fn(),
}));
vi.mock('../../../src/Scheduler/ConfigBootstrap.js', () => ({
  loadFullConfig: mockLoadFullConfig,
  loadLogConfig: vi.fn(() => ({ success: true, data: { logDir: '/tmp/logs' } })),
}));
vi.mock('../../../src/Config/ConfigValidator.js', () => {
  class MockConfigValidator {
    validateAll = mockValidateAll;
    static formatReport = mockFormatReport;
  }
  return { ConfigValidator: MockConfigValidator };
});

import { getConfiguredBankNames, runConfigValidation }
  from '../../../src/Scheduler/Telegram/ConfigHelpers.js';

describe('ConfigHelpers edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadFullConfig.mockReset();
    mockValidateAll.mockReset();
    mockFormatReport.mockReset();
  });

  it('getConfiguredBankNames returns names sorted by insertion order', () => {
    mockLoadFullConfig.mockReturnValue(
      succeed({ banks: { hapoalim: {}, leumi: {}, discount: {} } })
    );
    expect(getConfiguredBankNames()).toEqual(['hapoalim', 'leumi', 'discount']);
  });

  it('getConfiguredBankNames returns empty array when banks object is empty', () => {
    mockLoadFullConfig.mockReturnValue(succeed({ banks: {} }));
    expect(getConfiguredBankNames()).toEqual([]);
  });

  it('runConfigValidation returns FAIL prefix when raw config cannot load', async () => {
    mockLoadFullConfig.mockReturnValue(fail('missing config.json'));
    const out = await runConfigValidation();
    expect(out.startsWith('[FAIL]')).toBe(true);
    expect(out).toContain('missing config.json');
  });

  it('runConfigValidation delegates to ConfigValidator.formatReport on success', async () => {
    mockLoadFullConfig.mockReturnValue(succeed({ banks: {} }));
    mockValidateAll.mockResolvedValue([{ ok: true }]);
    mockFormatReport.mockReturnValue('FORMATTED REPORT');
    const out = await runConfigValidation();
    expect(out).toBe('FORMATTED REPORT');
    expect(mockFormatReport).toHaveBeenCalledWith([{ ok: true }]);
  });
});
