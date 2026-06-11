/**
 * Edge-case unit tests for JobProcessor â€” locks the spawn-and-collect
 * contract (poller stop before spawn, env merging, error
 * normalization, batch finalization side-effects). The end-to-end
 * happy path is already covered by tests/services/ImportMediator.test.ts;
 * this file exercises only the processor-local branches the
 * orchestrator does not assert directly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTracker,
  type IBatchTracker,
} from '../../../src/Services/Import/BatchFactory.js';
import BatchSummaryNotifier from '../../../src/Services/Import/BatchSummaryNotifier.js';
import JobProcessor, {
  type ITrackerStore,
} from '../../../src/Services/Import/JobProcessor.js';
import PollerLifecycle from '../../../src/Services/Import/PollerLifecycle.js';
import type { IImportJob, IImportRequestOptions } from '../../../src/Types/Index.js';

vi.mock('../../../src/Logger/Index.js', () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const baseOpts: IImportRequestOptions = { source: 'api' };

interface IHarness {
  sut: JobProcessor;
  spawnImport: ReturnType<typeof vi.fn>;
  pollerLifecycle: PollerLifecycle;
  onBatchFinalized: ReturnType<typeof vi.fn>;
  trackerStore: Map<string, IBatchTracker>;
}

const buildHarness = (
  spawnExitCode: number = 0,
  extraEnv?: Record<string, string>
): IHarness => {
  const spawnImport = vi.fn().mockResolvedValue(spawnExitCode);
  const pollerLifecycle = new PollerLifecycle();
  const summaryNotifier = new BatchSummaryNotifier(null);
  const onBatchFinalized = vi
    .fn()
    .mockReturnValue({ success: true, data: { status: 'recorded' } });
  const trackerStore = new Map<string, IBatchTracker>();
  const tracker = createTracker(
    'batch-1',
    extraEnv ? { ...baseOpts, extraEnv } : baseOpts,
    1
  );
  trackerStore.set(tracker.batchId, tracker);
  const sut = new JobProcessor({
    spawnImport,
    pollerLifecycle,
    summaryNotifier,
    trackerStore: trackerStore as unknown as ITrackerStore,
    onBatchFinalized,
  });
  return { sut, spawnImport, pollerLifecycle, onBatchFinalized, trackerStore };
};

const buildJob = (bankName: string = 'all'): IImportJob => ({
  id: 'job-1',
  bankName,
  batchId: 'batch-1',
  source: 'api',
});

describe('JobProcessor.processJob', () => {
  let harness: IHarness;

  beforeEach(() => {
    harness = buildHarness();
  });

  it('stops the poller before spawning the import', async () => {
    const stopSpy = vi.spyOn(harness.pollerLifecycle, 'stop');
    await harness.sut.processJob(buildJob());
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(harness.spawnImport).toHaveBeenCalledTimes(1);
  });

  it('passes only extraEnv when bankName is "all"', async () => {
    harness = buildHarness(0, { FOO: 'bar' });
    await harness.sut.processJob(buildJob('all'));
    expect(harness.spawnImport).toHaveBeenCalledWith({ FOO: 'bar' });
  });

  it('merges IMPORT_BANKS with extraEnv when bankName is a single bank', async () => {
    harness = buildHarness(0, { FOO: 'bar' });
    await harness.sut.processJob(buildJob('discount'));
    expect(harness.spawnImport).toHaveBeenCalledWith({
      IMPORT_BANKS: 'discount',
      FOO: 'bar',
    });
  });

  it('returns the exit code from spawnImport', async () => {
    harness = buildHarness(42);
    const result = await harness.sut.processJob(buildJob());
    expect(result.exitCode).toBe(42);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('defaults extraEnv to {} when the tracker is missing', async () => {
    harness.trackerStore.clear();
    await harness.sut.processJob(buildJob('all'));
    expect(harness.spawnImport).toHaveBeenCalledWith({});
  });
});

describe('JobProcessor.handleJobComplete', () => {
  let harness: IHarness;

  beforeEach(() => {
    harness = buildHarness();
  });

  it('returns failure when the batch is unknown', () => {
    const job: IImportJob = { ...buildJob(), batchId: 'missing-batch' };
    const result = harness.sut.handleJobComplete(job, {
      job, exitCode: 0, durationMs: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toContain('unknown batch');
  });

  it('records a job result and returns job-recorded status when more jobs are pending', () => {
    const tracker = createTracker('batch-multi', baseOpts, 2);
    harness.trackerStore.set(tracker.batchId, tracker);
    const job: IImportJob = { ...buildJob(), batchId: 'batch-multi' };
    const result = harness.sut.handleJobComplete(job, {
      job, exitCode: 0, durationMs: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('job-recorded');
    expect(tracker.results).toHaveLength(1);
    expect(harness.onBatchFinalized).not.toHaveBeenCalled();
  });

  it('fires onBatchFinalized and resolves the tracker once all jobs complete', async () => {
    const tracker = harness.trackerStore.get('batch-1')!;
    const job = buildJob();
    harness.sut.handleJobComplete(job, {
      job, exitCode: 0, durationMs: 1,
    });
    const batch = await tracker.promise;
    expect(batch.successCount).toBe(1);
    expect(batch.failureCount).toBe(0);
    expect(harness.onBatchFinalized).toHaveBeenCalledTimes(1);
    expect(harness.trackerStore.has('batch-1')).toBe(false);
  });

  it('treats an Error result as exit-code 1 in the aggregated batch', async () => {
    const tracker = harness.trackerStore.get('batch-1')!;
    const job = buildJob();
    harness.sut.handleJobComplete(job, new Error('spawn crashed'));
    const batch = await tracker.promise;
    expect(batch.successCount).toBe(0);
    expect(batch.failureCount).toBe(1);
    expect(batch.jobs[0].exitCode).toBe(1);
  });
});
