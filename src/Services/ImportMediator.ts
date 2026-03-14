/**
 * ImportMediator - Domain-aware orchestrator for import requests.
 * Single source of truth for import state, batch tracking, and poller lifecycle.
 */

import { randomUUID } from 'node:crypto';
import type {
  ImportJob, ImportJobResult, BatchResult,
  ImportRequestOptions, ImportSource,
} from '../Types/Index.js';
import type { INotifier } from './Notifications/INotifier.js';
import type { TelegramPoller } from './TelegramPoller.js';
import { ImportQueue } from './ImportQueue.js';
import { errorMessage } from '../Utils/Index.js';
import { getLogger } from '../Logger/Index.js';

/** Dependencies injected into the ImportMediator. */
export interface ImportMediatorOptions {
  /** Spawns a child process for one bank import. Returns exit code. */
  readonly spawnImport: (extraEnv: Record<string, string>) => Promise<number>;
  /** Returns all configured bank names. */
  readonly getBankNames: () => string[];
  /** Notifier for sending aggregate batch results. */
  readonly notifier: INotifier | null;
}

/** Internal batch tracker — not exported. */
interface BatchTracker {
  readonly batchId: string;
  readonly source: ImportSource;
  readonly startTime: number;
  readonly totalJobs: number;
  readonly extraEnv: Record<string, string>;
  readonly results: ImportJobResult[];
  resolve: (result: BatchResult) => void;
  readonly promise: Promise<BatchResult>;
}

/** Domain-aware orchestrator for import requests from any source. */
export class ImportMediator {
  private readonly queue: ImportQueue<ImportJob>;
  private readonly batches = new Map<string, BatchTracker>();
  private poller: TelegramPoller | null = null;
  private pollerStopped = false;
  private lastResult: BatchResult | null = null;
  private lastRunTime: Date | null = null;

  /**
   * Creates an ImportMediator wired to the given dependencies.
   * @param opts - Dependencies including spawn function, bank names, and notifier.
   */
  constructor(private readonly opts: ImportMediatorOptions) {
    this.queue = new ImportQueue<ImportJob>({
      process: this.processJob.bind(this),
      onJobComplete: this.handleJobComplete.bind(this),
      onQueueEmpty: this.handleQueueEmpty.bind(this),
    });
  }

  /**
   * Sets the Telegram poller reference (created after the mediator).
   * @param poller - The TelegramPoller instance to pause/resume around imports.
   */
  setPoller(poller: TelegramPoller): void {
    this.poller = poller;
  }

  /**
   * Requests an import for the specified banks (or all if undefined).
   * @param opts - Import request options including banks, source, and extra env.
   * @returns The batch ID, or null if an import is already active.
   */
  requestImport(opts: ImportRequestOptions): string | null {
    if (this.queue.isBusy()) return null;
    const batchId = randomUUID();
    const tracker = this.createTracker(batchId, opts, 1);
    this.batches.set(batchId, tracker);
    const label = opts.banks?.join(',') ?? 'all';
    const job = this.createJob(label, batchId, opts.source);
    this.queue.enqueue(job);
    return batchId;
  }

  /**
   * Returns a promise that resolves when the batch completes.
   * @param batchId - The batch ID returned by requestImport.
   * @returns Promise resolving to the BatchResult.
   */
  waitForBatch(batchId: string): Promise<BatchResult> {
    const tracker = this.batches.get(batchId);
    if (!tracker) {
      return Promise.reject(new Error(`Unknown batch: ${batchId}`));
    }
    return tracker.promise;
  }

  /**
   * Returns whether any import is currently active.
   * @returns True if the queue is busy.
   */
  isImporting(): boolean {
    return this.queue.isBusy();
  }

  /**
   * Returns the most recent completed batch result.
   * @returns Last BatchResult, or null if none.
   */
  getLastResult(): BatchResult | null {
    return this.lastResult;
  }

  /**
   * Returns the timestamp of the last completed batch.
   * @returns Date of last completion, or null.
   */
  getLastRunTime(): Date | null {
    return this.lastRunTime;
  }

  /**
   * Creates a BatchTracker with a placeholder resolve function.
   * @param batchId - Unique batch identifier.
   * @param opts - The original import request options.
   * @param totalJobs - Number of jobs in this batch.
   * @returns A new BatchTracker instance.
   */
  private createTracker(
    batchId: string,
    opts: ImportRequestOptions,
    totalJobs: number
  ): BatchTracker {
    /** Placeholder resolve — overwritten by Promise constructor. */
    let resolve: (result: BatchResult) => void = () => {};
    const promise = new Promise<BatchResult>((r) => {
      resolve = r;
    });
    return {
      batchId,
      source: opts.source,
      startTime: Date.now(),
      totalJobs,
      extraEnv: opts.extraEnv ?? {},
      results: [],
      resolve,
      promise,
    };
  }

  /**
   * Creates an ImportJob for one bank.
   * @param bankName - The bank to import.
   * @param batchId - The batch this job belongs to.
   * @param source - The source that triggered the import.
   * @returns A new ImportJob instance.
   */
  private createJob(
    bankName: string,
    batchId: string,
    source: ImportSource
  ): ImportJob {
    return { id: randomUUID(), bankName, batchId, source };
  }

  /**
   * Stops the poller and spawns a child process for an import job.
   * @param job - The ImportJob to execute.
   * @returns The ImportJobResult with exit code and duration.
   */
  private async processJob(job: ImportJob): Promise<ImportJobResult> {
    await this.stopPoller();
    const tracker = this.batches.get(job.batchId);
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
   * @param job - The completed ImportJob.
   * @param result - The result from processJob (or an Error if it threw).
   */
  private handleJobComplete(job: ImportJob, result: unknown): void {
    const tracker = this.batches.get(job.batchId);
    if (!tracker) return;
    const jobResult = this.toJobResult(job, result);
    tracker.results.push(jobResult);
    if (tracker.results.length === tracker.totalJobs) {
      void this.finalizeBatch(tracker);
    }
  }

  /**
   * Converts a raw result to an ImportJobResult, handling error cases.
   * @param job - The ImportJob that produced the result.
   * @param result - The raw result (ImportJobResult or Error).
   * @returns A normalized ImportJobResult.
   */
  private toJobResult(job: ImportJob, result: unknown): ImportJobResult {
    if (result && typeof result === 'object' && 'exitCode' in result) {
      return result as ImportJobResult;
    }
    return { job, exitCode: 1, durationMs: 0 };
  }

  /**
   * Builds the BatchResult, sends notification, and resolves waitForBatch.
   * @param tracker - The BatchTracker to finalize.
   */
  private async finalizeBatch(tracker: BatchTracker): Promise<void> {
    const batchResult = this.buildBatchResult(tracker);
    this.lastResult = batchResult;
    this.lastRunTime = new Date();
    await this.sendAggregateSummary(batchResult);
    tracker.resolve(batchResult);
    this.batches.delete(tracker.batchId);
  }

  /**
   * Builds a BatchResult from the tracker's collected job results.
   * @param tracker - The BatchTracker with all job results.
   * @returns The aggregate BatchResult.
   */
  private buildBatchResult(tracker: BatchTracker): BatchResult {
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
   * @param batch - The BatchResult to summarize.
   */
  private async sendAggregateSummary(batch: BatchResult): Promise<void> {
    if (!this.opts.notifier) return;
    const dur = (batch.totalDurationMs / 1000).toFixed(0);
    const icon = batch.failureCount === 0 ? '✅' : '\u26a0\ufe0f';
    const ok = batch.successCount;
    const total = batch.jobs.length;
    const msg = `${icon} Batch complete: ${ok}/${total} banks OK (${dur}s)`;
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
    if (this.pollerStopped || !this.poller) return;
    this.pollerStopped = true;
    await this.poller.stopAndFlush();
  }

  /** Resumes the Telegram poller after the queue drains. */
  private handleQueueEmpty(): void {
    if (!this.pollerStopped || !this.poller) return;
    this.pollerStopped = false;
    this.poller.start().catch((err: unknown) => {
      getLogger().error(
        `Failed to resume poller: ${errorMessage(err)}`
      );
    });
  }
}
