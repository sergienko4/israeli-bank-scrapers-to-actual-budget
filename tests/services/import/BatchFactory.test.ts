/**
 * Edge-case unit tests for BatchFactory pure constructors â€” locks
 * the deterministic contracts (deferred-promise shape, tracker
 * defaults, errorâ†’exit-code-1 normalisation, aggregate counts)
 * that ImportMediator depends on but does not assert directly.
 */
import { describe, expect, it } from 'vitest';

import {
  buildBatchResult,
  buildDeferredPromise,
  createJob,
  createTracker,
  type IBatchTracker,
  toJobResult,
} from '../../../src/Services/Import/BatchFactory.js';
import type {
  IBatchResult,
  IImportJob,
  IImportJobResult,
  IImportRequestOptions,
} from '../../../src/Types/Index.js';

const baseOpts: IImportRequestOptions = { source: 'api' };

const sampleJob: IImportJob = {
  id: 'job-1',
  bankName: 'discount',
  batchId: 'batch-1',
  source: 'api',
};

describe('buildDeferredPromise', () => {
  it('resolves the inner promise when resolve() is called', async () => {
    const deferred = buildDeferredPromise();
    const result: IBatchResult = {
      batchId: 'b', source: 'api', jobs: [],
      totalDurationMs: 0, successCount: 0, failureCount: 0,
    };
    deferred.resolve(result);
    await expect(deferred.promise).resolves.toBe(result);
  });

  it('resolve() returns a success Procedure with batch-resolved status', () => {
    const deferred = buildDeferredPromise();
    const result: IBatchResult = {
      batchId: 'b', source: 'api', jobs: [],
      totalDurationMs: 0, successCount: 0, failureCount: 0,
    };
    const procedure = deferred.resolve(result);
    expect(procedure.success).toBe(true);
    if (procedure.success) {
      expect(procedure.data.status).toBe('batch-resolved');
    }
  });
});

describe('createTracker', () => {
  it('seeds an empty results array', () => {
    const tracker = createTracker('batch-1', baseOpts, 3);
    expect(tracker.results).toEqual([]);
    expect(tracker.totalJobs).toBe(3);
  });

  it('defaults extraEnv to {} when opts.extraEnv is undefined', () => {
    const tracker = createTracker('batch-1', baseOpts, 1);
    expect(tracker.extraEnv).toEqual({});
  });

  it('preserves opts.extraEnv when supplied', () => {
    const tracker = createTracker(
      'batch-1',
      { source: 'api', extraEnv: { FOO: 'bar' } },
      1
    );
    expect(tracker.extraEnv).toEqual({ FOO: 'bar' });
  });
});

describe('createJob', () => {
  it('assigns a UUID-shaped id', () => {
    const job = createJob('discount', 'batch-1', 'api');
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('produces a different id on every call', () => {
    const a = createJob('discount', 'batch-1', 'api');
    const b = createJob('discount', 'batch-1', 'api');
    expect(b.id).not.toBe(a.id);
  });
});

describe('toJobResult', () => {
  it('normalizes an Error into exit-code 1 with zero duration', () => {
    const result = toJobResult(sampleJob, new Error('boom'));
    expect(result).toEqual({ job: sampleJob, exitCode: 1, durationMs: 0 });
  });

  it('returns a non-error result verbatim', () => {
    const raw: IImportJobResult = { job: sampleJob, exitCode: 0, durationMs: 42 };
    expect(toJobResult(sampleJob, raw)).toBe(raw);
  });
});

describe('buildBatchResult', () => {
  it('counts only exit-code-0 jobs as successes', () => {
    const tracker: IBatchTracker = {
      ...createTracker('batch-1', baseOpts, 3),
    };
    tracker.results.push(
      { job: sampleJob, exitCode: 0, durationMs: 1 },
      { job: sampleJob, exitCode: 1, durationMs: 1 },
      { job: sampleJob, exitCode: 0, durationMs: 1 }
    );
    const batch = buildBatchResult(tracker);
    expect(batch.successCount).toBe(2);
    expect(batch.failureCount).toBe(1);
  });

  it('reports zero counts when no results were collected', () => {
    const tracker = createTracker('batch-1', baseOpts, 0);
    const batch = buildBatchResult(tracker);
    expect(batch.successCount).toBe(0);
    expect(batch.failureCount).toBe(0);
    expect(batch.jobs).toEqual([]);
  });
});
