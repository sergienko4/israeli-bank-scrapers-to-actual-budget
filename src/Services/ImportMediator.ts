/**
 * ImportMediator - Domain-aware orchestrator for import requests.
 * Single source of truth for import state, batch tracking, and poller lifecycle.
 */

import { randomUUID } from 'node:crypto';

import type {
  IBatchResult,
  IImportJob,
  IImportRequestOptions,
  Procedure,
} from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import {
  createJob,
  createTracker,
  type IBatchTracker,
} from './Import/BatchFactory.js';
import BatchSummaryNotifier from './Import/BatchSummaryNotifier.js';
import JobProcessor from './Import/JobProcessor.js';
import PollerLifecycle from './Import/PollerLifecycle.js';
import ImportQueue from './ImportQueue.js';
import type { INotifier } from './Notifications/INotifier.js';
import type TelegramPoller from './TelegramPoller.js';

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
  private readonly _summaryNotifier: BatchSummaryNotifier;
  private readonly _pollerLifecycle: PollerLifecycle;
  private readonly _jobProcessor: JobProcessor;
  private _lastResult: IBatchResult | null = null;
  private _lastRunTime: Date | null = null;

  /**
   * Creates an ImportMediator wired to the given dependencies.
   * @param opts - Dependencies including spawn function, bank names, and notifier.
   */
  constructor(opts: IImportMediatorOptions) {
    this._summaryNotifier = new BatchSummaryNotifier(opts.notifier);
    this._pollerLifecycle = new PollerLifecycle();
    this._jobProcessor = new JobProcessor({
      spawnImport: opts.spawnImport,
      pollerLifecycle: this._pollerLifecycle,
      summaryNotifier: this._summaryNotifier,
      trackerStore: this._batches,
      onBatchFinalized: this.recordBatchResult.bind(this),
    });
    this._queue = new ImportQueue<IImportJob>({
      process: this._jobProcessor.processJob.bind(this._jobProcessor),
      onJobComplete: this._jobProcessor.handleJobComplete.bind(this._jobProcessor),
      onQueueEmpty: this.resumePollerAfterDrain.bind(this),
    });
  }

  /**
   * Sets the Telegram poller reference (created after the mediator).
   * @param poller - The TelegramPoller instance to pause/resume around imports.
   * @returns Procedure indicating the poller was set.
   */
  public setPoller(poller: TelegramPoller): Procedure<{ status: string }> {
    return this._pollerLifecycle.setPoller(poller);
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
   * Adapter for the ImportQueue onQueueEmpty callback — delegates
   * the actual resume to the poller-lifecycle state machine.
   * @returns Procedure indicating whether the poller was resumed.
   */
  private resumePollerAfterDrain(): Procedure<{ status: string }> {
    return this._pollerLifecycle.resume();
  }

  /**
   * Bookkeeping hook fired by JobProcessor after each batch finalizes.
   * @param batchResult - The aggregated IBatchResult that was just produced.
   * @returns Procedure confirming the last-result/last-run-time were updated.
   */
  private recordBatchResult(batchResult: IBatchResult): Procedure<{ status: string }> {
    this._lastResult = batchResult;
    this._lastRunTime = new Date();
    return succeed({ status: 'recorded' });
  }
}
