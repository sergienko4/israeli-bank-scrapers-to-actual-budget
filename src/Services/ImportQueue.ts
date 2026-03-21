/**
 * Generic sequential job queue.
 * Processes enqueued items one at a time via the provided process callback.
 */

import { getLogger } from '../Logger/Index.js';
import type { IQueueCallbacks, Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';

/** Generic sequential job queue that processes items via a provided callback. */
export default class ImportQueue<T> {
  private readonly _items: T[] = [];
  private _active = false;
  private readonly _callbacks: IQueueCallbacks<T>;

  /**
   * Creates an ImportQueue with the given processing callbacks.
   * @param callbacks - Process function and optional completion hooks.
   */
  constructor(callbacks: IQueueCallbacks<T>) {
    this._callbacks = callbacks;
  }

  /**
   * Adds a job to the queue and starts processing if idle.
   * @param job - The job to enqueue.
   */
  public enqueue(job: T): void {
    this._items.push(job);
    if (!this._active) void this.drain();
  }

  /**
   * Adds multiple jobs to the queue and starts processing if idle.
   * @param jobs - Array of jobs to enqueue.
   */
  public enqueueAll(jobs: T[]): void {
    if (jobs.length === 0) return;
    this._items.push(...jobs);
    if (!this._active) void this.drain();
  }

  /**
   * Returns the number of jobs waiting (not including the one currently processing).
   * @returns Pending queue length.
   */
  public size(): number {
    return this._items.length;
  }

  /**
   * Returns whether a job is currently being processed.
   * @returns True if processing is active.
   */
  public isProcessing(): boolean {
    return this._active;
  }

  /**
   * Returns true if the queue has pending jobs or is actively processing.
   * @returns True if not idle.
   */
  public isBusy(): boolean {
    return this._active || this._items.length > 0;
  }

  /**
   * Drains the queue by processing jobs sequentially until empty.
   * @returns Procedure indicating the queue has been drained.
   */
  private async drain(): Promise<Procedure<{ status: string }>> {
    this._active = true;
    await this.processNextItem();
    this._active = false;
    this._callbacks.onQueueEmpty();
    return succeed({ status: 'drained' });
  }

  /**
   * Recursively processes the next item in the queue.
   * @returns Procedure indicating all items were processed.
   */
  private async processNextItem(): Promise<Procedure<{ status: string }>> {
    if (this._items.length === 0) return succeed({ status: 'empty' });
    const job = this._items.shift() as T;
    await this.processOneJob(job);
    return this.processNextItem();
  }

  /**
   * Processes a single job, notifying the callback of success or failure.
   * @param job - The job to process.
   * @returns Procedure indicating the job was processed.
   */
  private async processOneJob(job: T): Promise<Procedure<{ status: string }>> {
    try {
      const result = await this._callbacks.process(job);
      this._callbacks.onJobComplete(job, result);
    } catch (err: unknown) {
      getLogger().error(`Queue job failed: ${errorMessage(err)}`);
      const jobError = err instanceof Error ? err : new Error(String(err));
      this._callbacks.onJobComplete(job, jobError);
    }
    return succeed({ status: 'job-processed' });
  }
}
