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
  private readonly _getBankNames: () => string[];
  private _lastResult: IBatchResult | null = null;
  private _lastRunTime: Date | null = null;

  /**
   * Creates an ImportMediator wired to the given dependencies.
   * @param opts - Dependencies including spawn function, bank names, and notifier.
   */
  constructor(opts: IImportMediatorOptions) {
    this._summaryNotifier = new BatchSummaryNotifier(opts.notifier);
    this._pollerLifecycle = new PollerLifecycle();
    this._jobProcessor = this.createJobProcessor(opts.spawnImport);
    this._getBankNames = opts.getBankNames;
    this._queue = this.createQueue();
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
   * Requests an import, isolating each bank in its own child process.
   *
   * One child per bank is a containment boundary, not an optimisation: a bank
   * whose scrape is killed by the kernel OOM reaper cannot be caught in-process,
   * so sharing a process across banks lets one bad bank cancel every other one.
   * @param opts - Import request options including banks, source, and extra env.
   * @returns The batch ID, or false if an import is already active.
   */
  public requestImport(opts: IImportRequestOptions): string | false {
    if (this._queue.isBusy()) return false;
    const batchId = randomUUID();
    const labels = this.resolveBankLabels(opts);
    const tracker = createTracker(batchId, opts, labels.length);
    this._batches.set(batchId, tracker);
    const jobs = labels.map((label) => createJob(label, batchId, opts.source));
    this._queue.enqueueAll(jobs);
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
   * Resolves the child processes a request fans out into, one label per bank.
   *
   * An empty result would produce a batch that never finalizes, because a
   * tracker only settles once a job result arrives, so an unresolvable bank
   * list degrades to a single all-banks child rather than a hung batch.
   * @param opts - Import request options carrying an optional explicit bank list.
   * @returns One job label per child process to spawn.
   */
  private resolveBankLabels(opts: IImportRequestOptions): string[] {
    const requested = opts.banks ?? this._getBankNames();
    if (requested.length === 0) return ['all'];
    return requested;
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

  /**
   * Builds the JobProcessor wired to its collaborators.
   * @param spawnImport - Function that spawns a child process for one bank.
   * @returns A configured JobProcessor.
   */
  private createJobProcessor(
    spawnImport: IImportMediatorOptions['spawnImport'],
  ): JobProcessor {
    return new JobProcessor({
      spawnImport,
      pollerLifecycle: this._pollerLifecycle,
      summaryNotifier: this._summaryNotifier,
      trackerStore: this._batches,
      onBatchFinalized: this.recordBatchResult.bind(this),
    });
  }

  /**
   * Builds the ImportQueue and binds its callbacks to the JobProcessor.
   * @returns A configured ImportQueue ready to accept jobs.
   */
  private createQueue(): ImportQueue<IImportJob> {
    return new ImportQueue<IImportJob>({
      process: this._jobProcessor.processJob.bind(this._jobProcessor),
      onJobComplete: this._jobProcessor.handleJobComplete.bind(this._jobProcessor),
      onQueueEmpty: this.resumePollerAfterDrain.bind(this),
    });
  }
}
