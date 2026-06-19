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

/** Mutable holder for the Promise executor's resolve callback. */
interface IResolverHolder {
  current: (r: IBatchResult) => IBatchResult;
}

/**
 * Identity placeholder for the resolver holder, returned unchanged
 * until the Promise executor overwrites it with the real resolve.
 * @param r - The batch result, passed through unchanged.
 * @returns The same batch result.
 */
function passthroughResult(r: IBatchResult): IBatchResult {
  return r;
}

/**
 * Wraps a holder's resolve callback as a Procedure-returning resolver.
 * @param holder - Holder whose `current` is set by the Promise executor.
 * @returns A resolve function that fulfils the batch promise.
 */
function makeBatchResolver(
  holder: IResolverHolder
): (result: IBatchResult) => Procedure<{ status: string }> {
  return (result: IBatchResult): Procedure<{ status: string }> => {
    holder.current(result);
    return succeed({ status: 'batch-resolved' });
  };
}

/**
 * Builds a deferred promise pair so callers can `await` a batch
 * result that will be resolved later by handleJobComplete.
 * @returns IDeferredBatchPromise with the promise and its resolve callback.
 */
export function buildDeferredPromise(): IDeferredBatchPromise {
  const holder: IResolverHolder = { current: passthroughResult };
  const promise = new Promise<IBatchResult>((cb) => {
    holder.current = cb as unknown as (r: IBatchResult) => IBatchResult;
  });
  const resolve = makeBatchResolver(holder);
  return { promise, resolve };
}

/** Identity + options + deferred promise needed to build a tracker. */
interface ITrackerParts {
  readonly batchId: string;
  readonly opts: IImportRequestOptions;
  readonly totalJobs: number;
  readonly deferred: IDeferredBatchPromise;
}

/**
 * Builds the non-identifying default fields of a tracker.
 * @param opts - The import request options.
 * @returns The extraEnv + results defaults.
 */
function trackerDefaults(
  opts: IImportRequestOptions
): Pick<IBatchTracker, 'extraEnv' | 'results'> {
  return { extraEnv: opts.extraEnv ?? {}, results: [] };
}

/**
 * Assembles a full IBatchTracker from its parts.
 * @param parts - The batch identity, options, and deferred promise.
 * @returns A new IBatchTracker.
 */
function assembleTracker(parts: ITrackerParts): IBatchTracker {
  return {
    ...parts.deferred,
    ...trackerDefaults(parts.opts),
    batchId: parts.batchId,
    source: parts.opts.source,
    startTime: Date.now(),
    totalJobs: parts.totalJobs,
  };
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
  return assembleTracker({ batchId, opts, totalJobs, deferred });
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

/** Success/failure tally for a batch's job results. */
interface IJobCounts {
  readonly successCount: number;
  readonly failureCount: number;
}

/**
 * Tallies success/failure counts from job results.
 * @param results - The collected job results.
 * @returns The success and failure counts.
 */
function jobCounts(results: readonly IImportJobResult[]): IJobCounts {
  const successCount = results.filter((r) => r.exitCode === 0).length;
  return { successCount, failureCount: results.length - successCount };
}

/**
 * Builds an IBatchResult from the tracker's collected job results.
 * @param tracker - The IBatchTracker with all job results.
 * @returns The aggregate IBatchResult.
 */
export function buildBatchResult(tracker: IBatchTracker): IBatchResult {
  return {
    ...jobCounts(tracker.results),
    batchId: tracker.batchId,
    source: tracker.source,
    jobs: tracker.results,
    totalDurationMs: Date.now() - tracker.startTime,
  };
}
