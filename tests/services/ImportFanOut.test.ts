/**
 * Blast-radius regression suite for the 2026-08 production outage.
 *
 * Before this suite existed, every configured bank was imported inside a
 * single child process. When one bank exhausted the container memory limit
 * the kernel SIGKILLed that process, so **no** bank was ever imported — a
 * 12-bank deployment produced zero transactions because bank #1 misbehaved.
 *
 * These tests pin the containment contract: one child process per bank, run
 * sequentially, so a bank that dies takes only itself down.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { ImportMediator } from '../../src/Services/ImportMediator.js';

vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createLogger: vi.fn(),
  deriveLogFormat: vi.fn().mockReturnValue('words'),
}));

/** Exit code Docker reports for a process killed by the OOM killer (128 + SIGKILL). */
const OOM_EXIT_CODE = 137;

type SpawnMock = Mock<(extraEnv: Record<string, string>) => Promise<number>>;

/**
 * Collects the IMPORT_BANKS value from every spawn call, in call order.
 * @param spawnImport - The spawn mock to inspect.
 * @returns The bank targeted by each child process, oldest call first.
 */
function spawnedBanks(spawnImport: SpawnMock): (string | undefined)[] {
  return spawnImport.mock.calls.map((call) => call[0].IMPORT_BANKS);
}

describe('ImportMediator per-bank fan-out', () => {
  let spawnImport: SpawnMock;
  let getBankNames: Mock<() => string[]>;

  beforeEach(() => {
    vi.clearAllMocks();
    spawnImport = vi
      .fn<(extraEnv: Record<string, string>) => Promise<number>>()
      .mockResolvedValue(0);
    getBankNames = vi
      .fn<() => string[]>()
      .mockReturnValue(['discount', 'visaCal', 'leumi']);
  });

  it('spawns one child process per configured bank for a cron run', async () => {
    const mediator = new ImportMediator({ spawnImport, getBankNames, notifier: null });

    const batchId = mediator.requestImport({ source: 'cron' });
    await mediator.waitForBatch(batchId as string);

    expect(spawnedBanks(spawnImport)).toEqual(['discount', 'visaCal', 'leumi']);
  });

  it('reports one job per bank in the batch result', async () => {
    const mediator = new ImportMediator({ spawnImport, getBankNames, notifier: null });

    const batchId = mediator.requestImport({ source: 'cron' });
    const result = await mediator.waitForBatch(batchId as string);

    expect(result.jobs).toHaveLength(3);
    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(0);
  });

  it('imports every surviving bank when the first bank is OOM-killed', async () => {
    spawnImport.mockImplementation(async (env) =>
      env.IMPORT_BANKS === 'discount' ? OOM_EXIT_CODE : 0,
    );
    const mediator = new ImportMediator({ spawnImport, getBankNames, notifier: null });

    const batchId = mediator.requestImport({ source: 'cron' });
    const result = await mediator.waitForBatch(batchId as string);

    expect(spawnedBanks(spawnImport)).toEqual(['discount', 'visaCal', 'leumi']);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(1);
  });

  it('keeps importing when every remaining bank also fails', async () => {
    spawnImport.mockResolvedValue(OOM_EXIT_CODE);
    const mediator = new ImportMediator({ spawnImport, getBankNames, notifier: null });

    const batchId = mediator.requestImport({ source: 'cron' });
    const result = await mediator.waitForBatch(batchId as string);

    expect(spawnImport).toHaveBeenCalledTimes(3);
    expect(result.failureCount).toBe(3);
  });

  it('runs the per-bank children sequentially, never in parallel', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    spawnImport.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return 0;
    });
    const mediator = new ImportMediator({ spawnImport, getBankNames, notifier: null });

    const batchId = mediator.requestImport({ source: 'cron' });
    await mediator.waitForBatch(batchId as string);

    expect(maxInFlight).toBe(1);
  });

  it('fans out only over the banks explicitly requested', async () => {
    const mediator = new ImportMediator({ spawnImport, getBankNames, notifier: null });

    const batchId = mediator.requestImport({
      source: 'telegram',
      banks: ['visaCal', 'leumi'],
    });
    await mediator.waitForBatch(batchId as string);

    expect(spawnedBanks(spawnImport)).toEqual(['visaCal', 'leumi']);
    expect(getBankNames).not.toHaveBeenCalled();
  });

  it('carries extra env into every per-bank child', async () => {
    const mediator = new ImportMediator({ spawnImport, getBankNames, notifier: null });

    const batchId = mediator.requestImport({
      source: 'telegram',
      extraEnv: { DRY_RUN: 'true' },
    });
    await mediator.waitForBatch(batchId as string);

    expect(spawnImport).toHaveBeenCalledTimes(3);
    expect(spawnImport).toHaveBeenNthCalledWith(1, {
      DRY_RUN: 'true',
      IMPORT_BANKS: 'discount',
    });
    expect(spawnImport).toHaveBeenNthCalledWith(3, {
      DRY_RUN: 'true',
      IMPORT_BANKS: 'leumi',
    });
  });

  it('falls back to a single all-banks child when no bank names resolve', async () => {
    getBankNames.mockReturnValue([]);
    const mediator = new ImportMediator({ spawnImport, getBankNames, notifier: null });

    const batchId = mediator.requestImport({ source: 'cron' });
    const result = await mediator.waitForBatch(batchId as string);

    expect(spawnImport).toHaveBeenCalledTimes(1);
    expect(spawnImport).toHaveBeenCalledWith({});
    expect(result.jobs).toHaveLength(1);
  });
});
