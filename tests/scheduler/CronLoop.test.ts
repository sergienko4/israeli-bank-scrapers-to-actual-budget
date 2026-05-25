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

const { mockSetTimeout } = vi.hoisted(() => ({
  mockSetTimeout: vi.fn(async (_ms: number) => void 0),
}));
vi.mock('node:timers/promises', () => ({
  setTimeout: mockSetTimeout,
}));

const { mockParse } = vi.hoisted(() => ({
  mockParse: vi.fn(),
}));
vi.mock('cron-parser', async () => {
  const actual =
    await vi.importActual<typeof import('cron-parser')>('cron-parser');
  return {
    ...actual,
    CronExpressionParser: {
      ...actual.CronExpressionParser,
      parse: (...args: Parameters<typeof actual.CronExpressionParser.parse>) =>
        mockParse.getMockImplementation()
          ? mockParse(...args)
          : actual.CronExpressionParser.parse(...args),
    },
  };
});

import {
  executeScheduleIteration,
  safeSleep,
  validateSchedule,
} from '../../src/Scheduler/CronLoop.js';

describe('CronLoop.validateSchedule', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns success with next-run timestamp for a valid cron expression', () => {
    const result = validateSchedule('0 */8 * * *');
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(typeof result.data.nextRunIso).toBe('string');
    expect(result.data.nextRunIso.length).toBeGreaterThan(0);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Next scheduled run:')
    );
  });

  it('returns failure for an invalid cron expression', () => {
    const result = validateSchedule('not-a-cron');
    expect(result.success).toBe(false);
    if (!isFail(result)) return;
    expect(result.message).toContain('Invalid SCHEDULE format');
  });

  it('respects TZ environment variable when parsing cron expression', () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const result = validateSchedule('0 12 * * *');
      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.nextRunIso).toContain('T');
    } finally {
      process.env.TZ = originalTz;
    }
  });
});

describe('CronLoop.safeSleep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetTimeout.mockClear();
  });

  it('resolves with a successful procedure for a small duration', async () => {
    const result = await safeSleep(1);
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data.status).toBe('waited');
  });

  it('clamps duration to MAX_TIMEOUT_MS for very large values', async () => {
    const MAX_TIMEOUT_MS = 2147483647;
    const result = await safeSleep(Number.MAX_SAFE_INTEGER);
    expect(result.success).toBe(true);
    expect(mockSetTimeout).toHaveBeenLastCalledWith(MAX_TIMEOUT_MS);
  });
});

describe('CronLoop.executeScheduleIteration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetTimeout.mockClear();
    mockParse.mockReset();
  });

  it('returns "continue" and warns when the mediator is busy', async () => {
    const pastRun = new Date(Date.now() - 1000);
    mockParse.mockImplementation(() => ({
      next: () => ({ toDate: () => pastRun }),
    }));
    const mediator = {
      requestImport: vi.fn(() => false),
    } as unknown as Parameters<typeof executeScheduleIteration>[1];

    const status = await executeScheduleIteration('* * * * *', mediator);

    expect(status).toBe('continue');
    expect(mediator.requestImport).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('import already in progress')
    );
  });
});
