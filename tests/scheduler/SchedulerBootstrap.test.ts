import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { succeed, fail } from '../../src/Types/ProcedureHelpers.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  getLogBuffer: vi.fn(),
  deriveLogFormat: vi.fn(() => 'words'),
}));

const { mockValidateSchedule, mockScheduleLoop } = vi.hoisted(() => ({
  mockValidateSchedule: vi.fn(),
  mockScheduleLoop: vi.fn(),
}));
vi.mock('../../src/Scheduler/CronLoop.js', () => ({
  validateSchedule: mockValidateSchedule,
  scheduleLoop: mockScheduleLoop,
  safeSleep: vi.fn(),
  executeScheduleIteration: vi.fn(),
}));

const { mockLoadLogConfig } = vi.hoisted(() => ({
  mockLoadLogConfig: vi.fn(),
}));
vi.mock('../../src/Scheduler/ConfigBootstrap.js', () => ({
  loadLogConfig: mockLoadLogConfig,
  loadFullConfig: vi.fn(),
  readJsonOrEncrypted: vi.fn(),
}));

const { mockCreateMediator, mockStartTelegramCommands } = vi.hoisted(() => ({
  mockCreateMediator: vi.fn(),
  mockStartTelegramCommands: vi.fn(),
}));
vi.mock('../../src/Scheduler/TelegramSchedulerWiring.js', () => ({
  createMediator: mockCreateMediator,
  startTelegramCommands: mockStartTelegramCommands,
  buildExtraCommands: vi.fn(),
  logCommandCount: vi.fn(),
  getConfiguredBankNames: vi.fn(),
  createReceiptHandler: vi.fn(),
}));

import { runScheduler } from '../../src/Scheduler/SchedulerBootstrap.js';

interface IFakeMediator {
  requestImport: ReturnType<typeof vi.fn>;
  waitForBatch: ReturnType<typeof vi.fn>;
}

function makeMediator(overrides: Partial<IFakeMediator> = {}): IFakeMediator {
  return {
    requestImport: vi.fn(() => 'batch-1'),
    waitForBatch: vi.fn(async () => ({ failureCount: 0 })),
    ...overrides,
  };
}

describe('SchedulerBootstrap.runScheduler', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const originalSchedule = process.env.SCHEDULE;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadLogConfig.mockReturnValue(succeed({ format: 'words', logDir: './logs' }));
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit:${String(code ?? 0)}`);
    }) as never);
    delete process.env.SCHEDULE;
  });

  afterEach(() => {
    exitSpy.mockRestore();
    if (originalSchedule === undefined) delete process.env.SCHEDULE;
    else process.env.SCHEDULE = originalSchedule;
  });

  it('runs one-shot import and exits with 0 when no SCHEDULE is set and batch succeeds', async () => {
    const mediator = makeMediator();
    mockStartTelegramCommands.mockResolvedValue(succeed(mediator));

    await expect(runScheduler()).rejects.toThrow('__exit:0');

    expect(mediator.requestImport).toHaveBeenCalledWith({ source: 'cron' });
    expect(mediator.waitForBatch).toHaveBeenCalledWith('batch-1');
  });

  it('runs one-shot import and exits with 1 when batch reports failures', async () => {
    const mediator = makeMediator({
      waitForBatch: vi.fn(async () => ({ failureCount: 2 })),
    });
    mockStartTelegramCommands.mockResolvedValue(succeed(mediator));

    await expect(runScheduler()).rejects.toThrow('__exit:1');
  });

  it('exits with 0 without waiting for a batch when requestImport returns false', async () => {
    const mediator = makeMediator({ requestImport: vi.fn(() => false) });
    mockStartTelegramCommands.mockResolvedValue(succeed(mediator));

    await expect(runScheduler()).rejects.toThrow('__exit:0');

    expect(mediator.waitForBatch).not.toHaveBeenCalled();
  });

  it('falls back to createMediator when telegram setup fails', async () => {
    const fallback = makeMediator();
    mockStartTelegramCommands.mockResolvedValue(fail('no telegram'));
    mockCreateMediator.mockReturnValue(fallback);

    await expect(runScheduler()).rejects.toThrow('__exit:0');

    expect(mockCreateMediator).toHaveBeenCalledTimes(1);
    expect(fallback.requestImport).toHaveBeenCalled();
  });

  it('enters the cron loop and returns success when SCHEDULE is set and valid', async () => {
    process.env.SCHEDULE = '0 */8 * * *';
    const mediator = makeMediator();
    mockStartTelegramCommands.mockResolvedValue(succeed(mediator));
    mockValidateSchedule.mockReturnValue(succeed({ nextRunIso: '2030-01-01T00:00:00Z' }));
    mockScheduleLoop.mockResolvedValue(succeed({ status: 'completed' }));

    const result = await runScheduler();

    expect(result.success).toBe(true);
    expect(mockScheduleLoop).toHaveBeenCalledWith('0 */8 * * *', mediator);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits with 1 when SCHEDULE is invalid', async () => {
    process.env.SCHEDULE = 'not-a-cron';
    const mediator = makeMediator();
    mockStartTelegramCommands.mockResolvedValue(succeed(mediator));
    mockValidateSchedule.mockReturnValue(fail('Invalid SCHEDULE format'));

    await expect(runScheduler()).rejects.toThrow('__exit:1');

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid SCHEDULE format')
    );
  });
});
