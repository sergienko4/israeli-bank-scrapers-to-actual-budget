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

import { bootScheduler, runScheduler } from '../../src/Scheduler/SchedulerBootstrap.js';
import type { ISchedulerProcessLifecycle } from '../../src/Scheduler/Process/SchedulerProcessLifecycle.js';

const { mockCheckCamoufoxFonts } = vi.hoisted(() => ({
  mockCheckCamoufoxFonts: vi.fn(),
}));
vi.mock('../../src/Scraper/CamoufoxFontGuard.js', () => ({
  default: mockCheckCamoufoxFonts,
}));

type FakeLifecycle = { [K in keyof ISchedulerProcessLifecycle]: ReturnType<typeof vi.fn> };

/**
 * Builds a lifecycle whose exits only record their calls, so control flow
 * after an exit request is observable.
 * @returns The recording lifecycle.
 */
function makeLifecycle(): FakeLifecycle {
  return {
    exitOnImportResult: vi.fn(),
    exitOnInvalidSchedule: vi.fn(),
    exitOnFatalError: vi.fn(),
    exitClean: vi.fn(),
  };
}

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

describe('SchedulerBootstrap.bootScheduler browser font check', () => {
  const fontFailure = 'Camoufox font check failed: CAMOUFOX_OS=macos selects the macos fingerprint';
  const originalSchedule = process.env.SCHEDULE;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadLogConfig.mockReturnValue(succeed({ format: 'words', logDir: './logs' }));
    delete process.env.SCHEDULE;
  });

  afterEach(() => {
    if (originalSchedule === undefined) delete process.env.SCHEDULE;
    else process.env.SCHEDULE = originalSchedule;
  });

  it('exits through the fatal-error path before the scheduler starts when the fonts are missing', async () => {
    mockCheckCamoufoxFonts.mockReturnValue(fail(fontFailure));
    const lifecycle = makeLifecycle();

    await bootScheduler(lifecycle as unknown as ISchedulerProcessLifecycle);

    expect(lifecycle.exitOnFatalError).toHaveBeenCalledTimes(1);
    const [error] = lifecycle.exitOnFatalError.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(fontFailure);
    expect(mockLoadLogConfig).not.toHaveBeenCalled();
    expect(mockStartTelegramCommands).not.toHaveBeenCalled();
    expect(lifecycle.exitClean).not.toHaveBeenCalled();
  });

  it('starts the scheduler when the fonts are present', async () => {
    mockCheckCamoufoxFonts.mockReturnValue(succeed({ os: 'windows' }));
    mockStartTelegramCommands.mockResolvedValue(succeed(makeMediator()));
    const lifecycle = makeLifecycle();

    await bootScheduler(lifecycle as unknown as ISchedulerProcessLifecycle);

    expect(mockStartTelegramCommands).toHaveBeenCalledTimes(1);
    expect(lifecycle.exitOnImportResult).toHaveBeenCalledWith({ failureCount: 0 });
    expect(lifecycle.exitOnFatalError).not.toHaveBeenCalled();
  });
});
