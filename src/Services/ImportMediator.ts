/**
 * ImportMediator - Domain-aware orchestrator for import requests.
 * Single source of truth for import state, batch tracking, and poller lifecycle.
 */

import { randomUUID } from 'node:crypto';

import { getLogger } from '../Logger/Index.js';
import type {
IBatchResult,
  IImportJob, IImportJobResult,   IImportRequestOptions, ImportSource, Procedure 
} from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import ImportQueue from './ImportQueue.js';
import type { INotifier } from './Notifications/INotifier.js';
import type TelegramPoller from './TelegramPoller.js';

/** Dependencies injected into the ImportMediator. */
export interface IImportMediatorOptions {
  /** Spawns a child process for one bank import. Returns exit code. */
  readonly spawnImport: (extraEnv: Record<string, string>) => Promise<number>;
  /** Returns all configured bank names. */
  readonly getBankNames: () => string[];
  /** Notifier for sending aggregate batch results. */
  readonly notifier: INotifier | null;
}

/** Internal batch tracker — not exported. */
interface IBatchTracker {
  readonly batchId: string;
  readonly source: ImportSource;
  readonly startTime: number;
  readonly totalJobs: number;
  readonly extraEnv: Record<string, string>;
  readonly results: IImportJobResult[];
  resolve: (result: IBatchResult) => Procedure<{ status: string }>;
  readonly promise: Promise<IBatchResult>;
}

/** Domain-aware orchestrator for import requests from any source. */
export class ImportMediator {
  private readonly _queue: ImportQueue<IImportJob>;
  private readonly _batches = new Map<string, IBatchTracker>();
  private _poller: TelegramPoller | null = null;
  private _pollerStopped = false;
  private _lastResult: IBatchResult | null = null;
  private _lastRunTime: Date | null = null;

  /**
   * Creates an ImportMediator wired to the given dependencies.
   * @param opts - Dependencies including spawn function, bank names, and notifier.
   */
  constructor(private readonly opts: IImportMediatorOptions) {
    this._queue = new ImportQueue<IImportJob>({
      process: this.processJob.bind(this),
      onJobComplete: this.handleJobComplete.bind(this),
      onQueueEmpty: this.handleQueueEmpty.bind(this),
    });
  }

  /**
   * Sets the Telegram poller reference (created after the mediator).
   * @param poller - The TelegramPoller instance to pause/resume around imports.
   * @returns Procedure indicating the poller was set.
   */
  public setPoller(poller: TelegramPoller): Procedure<{ status: string }> {
    this._poller = poller;
    return succeed({ status: 'poller-set' });
  }

  /**
   * Requests an import for the specified banks (or all if undefined).
   * @param opts - Import request options including banks, source, and extra env.
   * @returns The batch ID, or null if an import is already active.
   */
  public requestImport(opts: IImportRequestOptions): string | false {
    if (this._queue.isBusy()) return false;
    const batchId = randomUUID();
    const tracker = ImportMediator.createTracker(batchId, opts, 1);
    this._batches.set(batchId, tracker);
    const label = opts.banks?.join(',') ?? 'all';
    const job = ImportMediator.createJob(label, batchId, opts.source);
    this._queue.enqueue(job);
    return batchId;
  }

  /**
   * Returns a promise that resolves when the batch completes.
   * @param batchId - The batch ID returned by requestImport.
   * @returns Promise resolving to the IBatchResult.
   */
  public waitForBatch(batchId: string): Promise<IBatchResult> {
    const tracker = this._batches.get(batchId);
    if (!tracker) {
      return Promise.reject(new Error(`Unknown batch: ${batchId}`));
    }
    return tracker.promise;
  }

  /**
   * Returns whether any import is currently active.
   * @returns True if the queue is busy.
   */
  public isImporting(): boolean {
    return this._queue.isBusy();
  }

  /**
   * Returns the most recent completed batch result.
   * @returns Last IBatchResult, or null if none.
   */
  public getLastResult(): IBatchResult | null {
    return this._lastResult;
  }

  /**
   * Returns the timestamp of the last completed batch.
   * @returns Date of last completion, or null.
   */
  public getLastRunTime(): Date | null {
    return this._lastRunTime;
  }

  /**
   * Builds a deferred promise pair for batch resolution.
   * @returns Object with the promise and its resolve callback.
   */
  private static buildDeferredPromise(): {
    promise: Promise<IBatchResult>;
    resolve: (r: IBatchResult) => Procedure<{ status: string }>;
  } {
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
   * Creates a IBatchTracker with a deferred resolve.
   * @param batchId - Unique batch identifier.
   * @param opts - The original import request options.
   * @param totalJobs - Number of jobs in this batch.
   * @returns A new IBatchTracker instance.
   */
  private static createTracker(
    batchId: string,
    opts: IImportRequestOptions,
    totalJobs: number
  ): IBatchTracker {
    const deferred = ImportMediator.buildDeferredPromise();
    return {
      batchId, source: opts.source, startTime: Date.now(),
      totalJobs, extraEnv: opts.extraEnv ?? {}, results: [],
      resolve: deferred.resolve, promise: deferred.promise,
    };
  }

  /**
   * Creates an IImportJob for one bank.
   * @param bankName - The bank to import.
   * @param batchId - The batch this job belongs to.
   * @param source - The source that triggered the import.
   * @returns A new IImportJob instance.
   */
  private static createJob(
    bankName: string,
    batchId: string,
    source: ImportSource
  ): IImportJob {
    return { id: randomUUID(), bankName, batchId, source };
  }

  /**
   * Stops the poller and spawns a child process for an import job.
   * @param job - The IImportJob to execute.
   * @returns The IImportJobResult with exit code and duration.
   */
  private async processJob(job: IImportJob): Promise<IImportJobResult> {
    await this.stopPoller();
    const tracker = this._batches.get(job.batchId);
    const extra = tracker?.extraEnv ?? {};
    const env = job.bankName === 'all'
      ? extra
      : { IMPORT_BANKS: job.bankName, ...extra };
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
  private handleJobComplete(
    job: IImportJob,
    result: IImportJobResult | Error
  ): Procedure<{ status: string }> {
    const tracker = this._batches.get(job.batchId);
    if (!tracker) return fail(`unknown batch: ${job.batchId}`);
    const jobResult = ImportMediator.toJobResult(job, result);
    tracker.results.push(jobResult);
    if (tracker.results.length === tracker.totalJobs) {
      void this.finalizeBatch(tracker);
    }
    return succeed({ status: 'job-recorded' });
  }

  /**
   * Converts a raw result to an IImportJobResult, handling error cases.
   * @param job - The IImportJob that produced the result.
   * @param result - The raw result (IImportJobResult or Error).
   * @returns A normalized IImportJobResult.
   */
  private static toJobResult(job: IImportJob, result: IImportJobResult | Error): IImportJobResult {
    if (result instanceof Error) return { job, exitCode: 1, durationMs: 0 };
    return result;
  }

  /**
   * Builds the IBatchResult, sends notification, and resolves waitForBatch.
   * @param tracker - The IBatchTracker to finalize.
   */
  private async finalizeBatch(tracker: IBatchTracker): Promise<void> {
    const batchResult = ImportMediator.buildBatchResult(tracker);
    this._lastResult = batchResult;
    this._lastRunTime = new Date();
    await this.sendAggregateSummary(batchResult);
    tracker.resolve(batchResult);
    this._batches.delete(tracker.batchId);
  }

  /**
   * Builds a IBatchResult from the tracker's collected job results.
   * @param tracker - The IBatchTracker with all job results.
   * @returns The aggregate IBatchResult.
   */
  private static buildBatchResult(tracker: IBatchTracker): IBatchResult {
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

  /**
   * Sends an aggregate summary notification for the completed batch.
   * @param batch - The IBatchResult to summarize.
   */
  private async sendAggregateSummary(batch: IBatchResult): Promise<void> {
    if (!this.opts.notifier) return;
    const dur = (batch.totalDurationMs / 1000).toFixed(0);
    const icon = batch.failureCount === 0 ? '✅' : '\u26a0\ufe0f';
    const ok = batch.successCount;
    const total = batch.jobs.length;
    const msg = `${icon} Batch complete: ${String(ok)}/${String(total)} banks OK (${dur}s)`;
    try {
      await this.opts.notifier.sendMessage(msg);
    } catch (err: unknown) {
      getLogger().debug(
        `Failed to send batch summary: ${errorMessage(err)}`
      );
    }
  }

  /** Stops the Telegram poller before processing begins. */
  private async stopPoller(): Promise<void> {
    if (this._pollerStopped || !this._poller) return;
    this._pollerStopped = true;
    await this._poller.stopAndFlush();
  }

  /**
   * Resumes the Telegram poller after the queue drains.
   * @returns Procedure indicating whether the poller was resumed.
   */
  private handleQueueEmpty(): Procedure<{ status: string }> {
    if (!this._pollerStopped || !this._poller) return succeed({ status: 'no-poller' });
    this._pollerStopped = false;
    this._poller.start().catch((err: unknown) => {
      getLogger().error(
        `Failed to resume poller: ${errorMessage(err)}`
      );
    });
    return succeed({ status: 'poller-resumed' });
  }
}
