/**
 * Generic sequential job queue.
 * Processes enqueued items one at a time via the provided process callback.
 */

import type { QueueCallbacks } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import { getLogger } from '../Logger/Index.js';

/** Generic sequential job queue that processes items via a provided callback. */
export class ImportQueue<T> {
  private readonly items: T[] = [];
  private active = false;
  private readonly callbacks: QueueCallbacks<T>;

  /**
   * Creates an ImportQueue with the given processing callbacks.
   * @param callbacks - Process function and optional completion hooks.
   */
  constructor(callbacks: QueueCallbacks<T>) {
    this.callbacks = callbacks;
  }

  /**
   * Adds a job to the queue and starts processing if idle.
   * @param job - The job to enqueue.
   */
  enqueue(job: T): void {
    this.items.push(job);
    if (!this.active) void this.drain();
  }

  /**
   * Adds multiple jobs to the queue and starts processing if idle.
   * @param jobs - Array of jobs to enqueue.
   */
  enqueueAll(jobs: T[]): void {
    if (jobs.length === 0) return;
    this.items.push(...jobs);
    if (!this.active) void this.drain();
  }

  /**
   * Returns the number of jobs waiting (not including the one currently processing).
   * @returns Pending queue length.
   */
  size(): number {
    return this.items.length;
  }

  /**
   * Returns whether a job is currently being processed.
   * @returns True if processing is active.
   */
  isProcessing(): boolean {
    return this.active;
  }

  /**
   * Returns true if the queue has pending jobs or is actively processing.
   * @returns True if not idle.
   */
  isBusy(): boolean {
    return this.active || this.items.length > 0;
  }

  /**
   * Drains the queue by processing jobs sequentially until empty.
   */
  private async drain(): Promise<void> {
    this.active = true;
    while (this.items.length > 0) {
      const job = this.items.shift() as T;
      try {
        const result = await this.callbacks.process(job);
        this.callbacks.onJobComplete?.(job, result);
      } catch (err: unknown) {
        getLogger().error(`Queue job failed: ${errorMessage(err)}`);
        this.callbacks.onJobComplete?.(job, err);
      }
    }
    this.active = false;
    this.callbacks.onQueueEmpty?.();
  }
}
