/**
 * TelegramPollRun — the state owned by one run of {@link TelegramPoller}.
 *
 * Every start() creates a fresh run, so a run that is replaced while its poll
 * or handler is still in flight can only change its own liveness, error count
 * and cancellation handles. When these were shared poller fields, a late cycle
 * from a replaced run could stop the new run, take over its backoff sleep, or
 * reset its error count.
 */

import type { Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import type { PollOutcome } from './TelegramPollHttp.js';
import TelegramPollRecovery from './TelegramPollRecovery.js';

/** Sends one long poll carrying the given abort signal. */
export type AbortablePoll = (signal: AbortSignal) => Promise<PollOutcome>;

/** One poll-loop run: its liveness, start time, error policy and cancellation. */
export default class TelegramPollRun {
  /** Classifies this run's poll failures; a new run starts with a zero count. */
  public readonly recovery = new TelegramPollRecovery();
  /** Unix seconds when the run started; earlier messages are not dispatched. */
  public readonly startedAt = Math.floor(Date.now() / 1000);
  private _isActive = true;
  private _pollController: AbortController | null = null;
  private _sleepController: AbortController | null = null;

  /**
   * Whether the run may start another poll cycle.
   *
   * @returns False once the run has been ended or stopped.
   */
  public get isActive(): boolean {
    return this._isActive;
  }

  /**
   * Ends the run once its in-flight cycle settles, cutting any backoff sleep
   * short. An in-flight poll is left to finish so its updates still dispatch.
   *
   * @returns Nothing — this is a side-effecting state change.
   */
  public end(): void {
    this._isActive = false;
    this._sleepController?.abort();
  }

  /**
   * Ends the run and also aborts its in-flight long poll.
   *
   * @returns Nothing — this is a side-effecting state change.
   */
  public stop(): void {
    this.end();
    this._pollController?.abort();
  }

  /**
   * Runs one long poll that {@link TelegramPollRun.stop} can abort.
   *
   * @param poll - Sends the request with the abort signal this run controls.
   * @returns The outcome the poll resolved with.
   */
  public async poll(poll: AbortablePoll): Promise<PollOutcome> {
    const controller = new AbortController();
    this._pollController = controller;
    try {
      return await poll(controller.signal);
    } finally {
      this._pollController = null;
    }
  }

  /**
   * Waits out a retry backoff, returning early when the run is ended.
   *
   * @param ms - Backoff duration in milliseconds.
   * @returns Resolves when the backoff elapses or the run is ended.
   */
  public async sleep(ms: number): Promise<Procedure<{ status: string }>> {
    const controller = new AbortController();
    this._sleepController = controller;
    try {
      await new Promise<void>((resolve) => {
        const timer = globalThis.setTimeout(resolve, ms);
        controller.signal.addEventListener('abort', () => {
          globalThis.clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    } finally {
      this._sleepController = null;
    }
    return succeed({ status: 'slept' });
  }
}
