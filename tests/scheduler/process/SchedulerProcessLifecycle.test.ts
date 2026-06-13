import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  buildSchedulerProcessLifecycle,
  type IExitable,
} from '../../../src/Scheduler/Process/SchedulerProcessLifecycle.js';

const fakeLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

interface IFakeExit {
  readonly exitable: IExitable;
  readonly calls: number[];
}

function makeFakeExit(): IFakeExit {
  const calls: number[] = [];
  const exitable: IExitable = {
    exit: (code: number): never => {
      calls.push(code);
      throw new Error(`__exit:${String(code)}`);
    },
  };
  return { exitable, calls };
}

describe('SchedulerProcessLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exitOnImportResult — exits 0 when failureCount is 0', () => {
    const { exitable, calls } = makeFakeExit();
    const lc = buildSchedulerProcessLifecycle({ logger: fakeLogger, exitable });

    expect(() => lc.exitOnImportResult({ failureCount: 0 })).toThrow('__exit:0');
    expect(calls).toEqual([0]);
  });

  it('exitOnImportResult — exits 1 when failureCount > 0', () => {
    const { exitable, calls } = makeFakeExit();
    const lc = buildSchedulerProcessLifecycle({ logger: fakeLogger, exitable });

    expect(() => lc.exitOnImportResult({ failureCount: 3 })).toThrow('__exit:1');
    expect(calls).toEqual([1]);
  });

  it('exitOnInvalidSchedule — logs reason + example then exits 1', () => {
    const { exitable, calls } = makeFakeExit();
    const lc = buildSchedulerProcessLifecycle({ logger: fakeLogger, exitable });

    expect(() => lc.exitOnInvalidSchedule('Invalid SCHEDULE format')).toThrow('__exit:1');
    expect(calls).toEqual([1]);
    expect(fakeLogger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid SCHEDULE format'));
    expect(fakeLogger.error).toHaveBeenCalledWith(expect.stringContaining('Example:'));
  });

  it('exitOnFatalError — logs message + exits 1 for Error instance', () => {
    const { exitable, calls } = makeFakeExit();
    const lc = buildSchedulerProcessLifecycle({ logger: fakeLogger, exitable });

    expect(() => lc.exitOnFatalError(new Error('boom'))).toThrow('__exit:1');
    expect(calls).toEqual([1]);
    expect(fakeLogger.error).toHaveBeenCalledWith(expect.stringContaining('Fatal error: boom'));
  });

  it('exitOnFatalError — coerces non-Error values via errorMessage', () => {
    const { exitable } = makeFakeExit();
    const lc = buildSchedulerProcessLifecycle({ logger: fakeLogger, exitable });

    expect(() => lc.exitOnFatalError('string-failure')).toThrow('__exit:1');
    expect(fakeLogger.error).toHaveBeenCalledWith(expect.stringContaining('string-failure'));
  });

  it('exitClean — exits 0 without logging', () => {
    const { exitable, calls } = makeFakeExit();
    const lc = buildSchedulerProcessLifecycle({ logger: fakeLogger, exitable });

    expect(() => lc.exitClean()).toThrow('__exit:0');
    expect(calls).toEqual([0]);
    expect(fakeLogger.error).not.toHaveBeenCalled();
    expect(fakeLogger.info).not.toHaveBeenCalled();
  });

  it('defaults — uses live getLogger + process.exit wrapper when deps omitted', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit:${String(code ?? 0)}`);
    }) as never);
    try {
      const lc = buildSchedulerProcessLifecycle();
      expect(() => lc.exitClean()).toThrow('__exit:0');
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('returned handle is frozen', () => {
    const { exitable } = makeFakeExit();
    const lc = buildSchedulerProcessLifecycle({ logger: fakeLogger, exitable });
    expect(Object.isFrozen(lc)).toBe(true);
  });
});
