/**
 * JobProcessor - executes individual import jobs and aggregates their
 * results into batch outcomes. Owns the spawn-and-collect loop so the
 * ImportMediator can stay a pure composition root.
 */

import type {
  IBatchResult,
  IImportJob,
  IImportJobResult,
  Procedure,
} from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import {
  buildBatchResult,
  type IBatchTracker,
  toJobResult,
} from './BatchFactory.js';
import type BatchSummaryNotifier from './BatchSummaryNotifier.js';
import type PollerLifecycle from './PollerLifecycle.js';

/** Spawn function signature: spawns one child import and returns its exit code. */
export type SpawnImport = (extraEnv: Record<string, string>) => Promise<number>;

/** Callback fired once a batch has been finalized, carrying the aggregated result. */
export type BatchFinalizedCallback = (
  result: IBatchResult
) => Procedure<{ status: string }>;

/** Tracker-store contract used by the JobProcessor (read + delete only). */
export interface ITrackerStore {
  /** Look up a tracker by batch id. */
  get(batchId: string): IBatchTracker | undefined;
  /** Remove a tracker once its batch has been resolved. */
  delete(batchId: string): void;
}

/** Constructor dependencies for JobProcessor. */
export interface IJobProcessorOptions {
  /** Spawns the child process for one bank import. */
  readonly spawnImport: SpawnImport;
  /** Poller lifecycle used to pause the poller while a job is running. */
  readonly pollerLifecycle: PollerLifecycle;
  /** Notifier used to broadcast aggregated batch summaries. */
  readonly summaryNotifier: BatchSummaryNotifier;
  /** Store of in-flight batch trackers. */
  readonly trackerStore: ITrackerStore;
  /** Fired exactly once per batch, after the tracker has been resolved. */
  readonly onBatchFinalized: BatchFinalizedCallback;
}

/**
 * Shapes the child-process environment for one import job.
 * @param bankName - The bank to import, or `all` for every configured bank.
 * @param extra - Extra environment entries carried by the batch tracker.
 * @returns The environment map passed to spawnImport.
 */
function buildJobEnv(
  bankName: string,
  extra: Record<string, string>
): Record<string, string> {
  if (bankName === 'all') return extra;
  return { IMPORT_BANKS: bankName, ...extra };
}

/** Owns the per-job spawn + per-batch finalization flow. */
export default class JobProcessor {
  /**
   * Wires the JobProcessor to its collaborators.
   * @param opts - Injected dependencies for spawning, polling, notifying, and tracker access.
   */
  constructor(private readonly opts: IJobProcessorOptions) {}

  /**
   * Stops the poller and spawns a child process for an import job.
   * @param job - The IImportJob to execute.
   * @returns The IImportJobResult with exit code and duration.
   */
  public async processJob(job: IImportJob): Promise<IImportJobResult> {
    await this.opts.pollerLifecycle.stop();
    const tracker = this.opts.trackerStore.get(job.batchId);
    const env = buildJobEnv(job.bankName, tracker?.extraEnv ?? {});
    const start = Date.now();
    const exitCode = await this.opts.spawnImport(env);
    return { job, exitCode, durationMs: Date.now() - start };
  }

  /**
   * Records a job result and finalizes the batch if all jobs are done.
   * @param job - The completed IImportJob.
   * @param result - The result from processJob (or an Error if it threw).
   * @returns Procedure indicating the job was recorded, or failure if the batch is unknown.
   */
  public handleJobComplete(
    job: IImportJob,
    result: IImportJobResult | Error
  ): Procedure<{ status: string }> {
    const tracker = this.opts.trackerStore.get(job.batchId);
    if (!tracker) return fail(`unknown batch: ${job.batchId}`);
    const jobResult = toJobResult(job, result);
    this.recordAndMaybeFinalize(tracker, jobResult);
    return succeed({ status: 'job-recorded' });
  }

  /**
   * Records a job result on the tracker and finalizes the batch once every
   * job has reported in.
   * @param tracker - The batch tracker accumulating job results.
   * @param jobResult - The result to append.
   */
  private recordAndMaybeFinalize(
    tracker: IBatchTracker,
    jobResult: IImportJobResult
  ): void {
    tracker.results.push(jobResult);
    if (tracker.results.length === tracker.totalJobs) {
      void this.finalizeBatch(tracker);
    }
  }

  /**
   * Builds the IBatchResult, sends notification, resolves the tracker, and
   * fires the onBatchFinalized callback so the host can update its
   * last-result bookkeeping.
   * @param tracker - The IBatchTracker to finalize.
   */
  private async finalizeBatch(tracker: IBatchTracker): Promise<void> {
    const batchResult = buildBatchResult(tracker);
    this.opts.onBatchFinalized(batchResult);
    await this.opts.summaryNotifier.send(batchResult);
    tracker.resolve(batchResult);
    this.opts.trackerStore.delete(tracker.batchId);
  }
}
