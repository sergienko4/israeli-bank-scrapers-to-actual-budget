/**
 * ImportMediator - Domain-aware orchestrator for import requests.
 * Single source of truth for import state, batch tracking, and poller lifecycle.
 */

import { randomUUID } from 'node:crypto';

import { getLogger } from '../Logger/Index.js';
import type {
  IBatchResult,
  IImportJob,
  IImportJobResult,
  IImportRequestOptions,
  Procedure,
} from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import {
  buildBatchResult,
  createJob,
  createTracker,
  type IBatchTracker,
  toJobResult,
} from './Import/BatchFactory.js';
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
    const tracker = createTracker(batchId, opts, 1);
    this._batches.set(batchId, tracker);
    const label = opts.banks?.join(',') ?? 'all';
    const job = createJob(label, batchId, opts.source);
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
    const jobResult = toJobResult(job, result);
    tracker.results.push(jobResult);
    if (tracker.results.length === tracker.totalJobs) {
      void this.finalizeBatch(tracker);
    }
    return succeed({ status: 'job-recorded' });
  }

  /**
   * Builds the IBatchResult, sends notification, and resolves waitForBatch.
   * @param tracker - The IBatchTracker to finalize.
   */
  private async finalizeBatch(tracker: IBatchTracker): Promise<void> {
    const batchResult = buildBatchResult(tracker);
    this._lastResult = batchResult;
    this._lastRunTime = new Date();
    await this.sendAggregateSummary(batchResult);
    tracker.resolve(batchResult);
    this._batches.delete(tracker.batchId);
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
