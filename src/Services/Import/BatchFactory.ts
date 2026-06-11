/**
 * BatchFactory — pure constructors for ImportMediator batch state.
 *
 * Extracted from ImportMediator to isolate state-shape concerns:
 *  - Deferred-promise pair for `waitForBatch`.
 *  - IBatchTracker construction (per-batch state).
 *  - IImportJob construction (per-bank job).
 *  - Result normalization (Error → exit-code 1).
 *  - Aggregate IBatchResult construction from accumulated results.
 *
 * All methods are pure (no I/O, no mutable state) except for
 * randomUUID()/Date.now() side effects that the orchestrator already
 * intentionally relies on for batch identity and timing.
 */

import { randomUUID } from 'node:crypto';

import type {
  IBatchResult,
  IImportJob,
  IImportJobResult,
  IImportRequestOptions,
  ImportSource,
  Procedure,
} from '../../Types/Index.js';
import { succeed } from '../../Types/Index.js';

/**
 * Internal batch tracker shape — carried by ImportMediator across the
 * job lifecycle from enqueue → all-jobs-done → resolve.
 */
export interface IBatchTracker {
  readonly batchId: string;
  readonly source: ImportSource;
  readonly startTime: number;
  readonly totalJobs: number;
  readonly extraEnv: Record<string, string>;
  readonly results: IImportJobResult[];
  resolve: (result: IBatchResult) => Procedure<{ status: string }>;
  readonly promise: Promise<IBatchResult>;
}

/** Deferred promise pair returned by buildDeferredPromise. */
export interface IDeferredBatchPromise {
  readonly promise: Promise<IBatchResult>;
  readonly resolve: (r: IBatchResult) => Procedure<{ status: string }>;
}

/**
 * Builds a deferred promise pair so callers can `await` a batch
 * result that will be resolved later by handleJobComplete.
 * @returns IDeferredBatchPromise with the promise and its resolve callback.
 */
export function buildDeferredPromise(): IDeferredBatchPromise {
  /**
   * Placeholder — overwritten by Promise constructor.
   * @param r - The batch result to pass through.
   * @returns The same batch result.
   */
  let doResolve: (r: IBatchResult) => IBatchResult = (r) => r;
  const promise = new Promise<IBatchResult>((cb) => {
    doResolve = cb as unknown as (r: IBatchResult) => IBatchResult;
  });
  /**
   * Resolves the batch promise and returns a Procedure.
   * @param result - The IBatchResult to resolve with.
   * @returns Procedure indicating the batch was resolved.
   */
  const resolve = (
    result: IBatchResult
  ): Procedure<{ status: string }> => {
    doResolve(result);
    return succeed({ status: 'batch-resolved' });
  };
  return { promise, resolve };
}

/**
 * Creates an IBatchTracker with a deferred resolve.
 * @param batchId - Unique batch identifier.
 * @param opts - The original import request options.
 * @param totalJobs - Number of jobs in this batch.
 * @returns A new IBatchTracker instance.
 */
export function createTracker(
  batchId: string,
  opts: IImportRequestOptions,
  totalJobs: number
): IBatchTracker {
  const deferred = buildDeferredPromise();
  return {
    batchId,
    source: opts.source,
    startTime: Date.now(),
    totalJobs,
    extraEnv: opts.extraEnv ?? {},
    results: [],
    resolve: deferred.resolve,
    promise: deferred.promise,
  };
}

/**
 * Creates an IImportJob for one bank.
 * @param bankName - The bank to import.
 * @param batchId - The batch this job belongs to.
 * @param source - The source that triggered the import.
 * @returns A new IImportJob instance.
 */
export function createJob(
  bankName: string,
  batchId: string,
  source: ImportSource
): IImportJob {
  return { id: randomUUID(), bankName, batchId, source };
}

/**
 * Converts a raw result to an IImportJobResult, handling error cases.
 * @param job - The IImportJob that produced the result.
 * @param result - The raw result (IImportJobResult or Error).
 * @returns A normalized IImportJobResult.
 */
export function toJobResult(
  job: IImportJob,
  result: IImportJobResult | Error
): IImportJobResult {
  if (result instanceof Error) return { job, exitCode: 1, durationMs: 0 };
  return result;
}

/**
 * Builds an IBatchResult from the tracker's collected job results.
 * @param tracker - The IBatchTracker with all job results.
 * @returns The aggregate IBatchResult.
 */
export function buildBatchResult(tracker: IBatchTracker): IBatchResult {
  const successCount = tracker.results.filter(
    (r) => r.exitCode === 0
  ).length;
  return {
    batchId: tracker.batchId,
    source: tracker.source,
    jobs: tracker.results,
    totalDurationMs: Date.now() - tracker.startTime,
    successCount,
    failureCount: tracker.results.length - successCount,
  };
}
