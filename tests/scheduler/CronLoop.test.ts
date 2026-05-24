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

import { validateSchedule, safeSleep } from '../../src/Scheduler/CronLoop.js';

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
});

describe('CronLoop.safeSleep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves with a successful procedure for a small duration', async () => {
    const result = await safeSleep(1);
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data.status).toBe('waited');
  });
});
