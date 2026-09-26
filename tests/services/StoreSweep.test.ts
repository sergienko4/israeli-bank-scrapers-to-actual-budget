/**
 * Sweeping the runtime stores' staging leftovers when a process starts.
 *
 * <p>A killed write leaves its staged file behind, and only a sweep removes
 * it. The sweep is housekeeping: a failure warns and never stops the start,
 * a missing directory means nothing was ever staged there, and one store's
 * failure does not keep the others from being swept.
 */

import { describe, expect, it, vi } from 'vitest';

import type { ILogger } from '../../src/Logger/ILogger.js';
import type { ISweepTarget } from '../../src/Services/StoreSweep.js';
import sweepStores from '../../src/Services/StoreSweep.js';
import type { ISweepReport } from '../../src/Storage/StoreTypes.js';
import type { Procedure } from '../../src/Types/Index.js';
import { fail, succeed } from '../../src/Types/Index.js';

/**
 * Builds a logger whose calls the cases inspect.
 * @returns A logger with spy methods.
 */
function spyLogger(): ILogger & { warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> } {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger & {
    warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>;
  };
}

/**
 * Builds a target whose sweep reports the given outcome.
 * @param label - What the store is called in log lines.
 * @param outcome - What its sweep reports.
 * @returns The target and the spy on its sweep.
 */
function target(
  label: string, outcome: () => Procedure<ISweepReport>,
): { target: ISweepTarget; sweep: ReturnType<typeof vi.fn> } {
  const sweep = vi.fn(outcome);
  return { target: { label, open: () => ({ sweepStagedLeftovers: sweep }) }, sweep };
}

/**
 * A sweep that removed the given number of leftovers.
 * @param removedCount - How many were removed.
 * @returns The successful report.
 */
function removed(removedCount: number): Procedure<ISweepReport> {
  return succeed({ removedCount, summary: `Removed ${String(removedCount)} abandoned staged files` });
}

describe('sweepStores', () => {
  it('sweeps every store and counts the clean sweeps', () => {
    const first = target('OTP settings', () => removed(0));
    const second = target('device tokens', () => removed(0));
    const logger = spyLogger();
    expect(sweepStores([first.target, second.target], logger)).toBe(2);
    expect(first.sweep).toHaveBeenCalledTimes(1);
    expect(second.sweep).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('says what it removed beside which store', () => {
    const logger = spyLogger();
    sweepStores([target('OTP requests', () => removed(2)).target], logger);
    expect(logger.info).toHaveBeenCalledWith(
      '  🧹 Removed 2 abandoned staged files beside the OTP requests',
    );
  });

  it('stays quiet when nothing was left behind', () => {
    const logger = spyLogger();
    sweepStores([target('OTP requests', () => removed(0)).target], logger);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('warns about a failed sweep and still sweeps the next store', () => {
    const failing = target('audit log', () => fail('Could not list /data: EACCES', { status: 'EACCES' }));
    const next = target('device tokens', () => removed(0));
    const logger = spyLogger();
    expect(sweepStores([failing.target, next.target], logger)).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Could not sweep staged audit log files: Could not list /data: EACCES',
    );
    expect(next.sweep).toHaveBeenCalledTimes(1);
  });

  it('treats a missing directory as nothing to sweep', () => {
    const missing = target('audit log', () => fail('Could not list /data: ENOENT', { status: 'ENOENT' }));
    const logger = spyLogger();
    expect(sweepStores([missing.target], logger)).toBe(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns about a sweep that throws and still sweeps the next store', () => {
    const throwing = target('OTP settings', () => { throw new TypeError('boom'); });
    const next = target('device tokens', () => removed(0));
    const logger = spyLogger();
    expect(sweepStores([throwing.target, next.target], logger)).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith('Could not sweep staged OTP settings files: boom');
    expect(next.sweep).toHaveBeenCalledTimes(1);
  });
});
