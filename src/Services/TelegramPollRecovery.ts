/**
 * TelegramPollRecovery — error-classification + backoff policy for the
 * Telegram long-poll loop.
 *
 * Owns the consecutive-error counter and decides, for each poll failure,
 * whether the loop must stop (a fatal HTTP code or a circuit-breaker trip)
 * or retry after an exponential backoff sleep. Logging the failure is a
 * side effect of classification; the caller ({@link TelegramPoller}) owns
 * loop control and the interruptible sleep.
 *
 * Extracted from {@link TelegramPoller} so the retry behaviour is an
 * independently-testable policy object (the design-patterns "Policy
 * Pattern" for retries/timeouts), keeping the poller a thin lifecycle shell.
 */

import { getLogger } from '../Logger/Index.js';
import { errorMessage } from '../Utils/Index.js';
import {
  backoffSeconds, computeBackoff, isFatalHttpCode,
} from './TelegramPollBackoff.js';

const MAX_CONSECUTIVE_ERRORS = 60;

/** The action the poll loop must take after a failed cycle. */
export type RecoveryOutcome = 'fatal-stop' | 'circuit-breaker-stop' | 'retry';

/**
 * A classified recovery decision returned to the poll loop.
 *
 * Discriminated on {@link RecoveryOutcome}: a 'retry' decision always carries
 * its backoff `sleepMs`, while a stop decision never does — invalid
 * retry-without-delay states are unrepresentable at the type level.
 */
export type IRecoveryDecision =
  | {
    /** Discriminant marking a retryable failure. */
    readonly outcome: 'retry';
    /** The status string the poll cycle resolves with. */
    readonly status: string;
    /** Backoff delay in milliseconds before the next poll attempt. */
    readonly sleepMs: number;
  }
  | {
    /** Discriminant marking a fatal HTTP code or circuit-breaker trip. */
    readonly outcome: Exclude<RecoveryOutcome, 'retry'>;
    /** The status string the poll cycle resolves with. */
    readonly status: string;
  };

/** Classifies Telegram poll failures into stop/retry decisions with backoff. */
export default class TelegramPollRecovery {
  private _consecutiveErrors = 0;

  /**
   * Resets the consecutive-error counter after a successful poll or restart.
   *
   * @returns Nothing — this is a side-effecting setter.
   */
  public reset(): void {
    this._consecutiveErrors = 0;
  }

  /**
   * Classifies an HTTP error, stopping on fatal codes or applying backoff.
   *
   * @param httpCode - The HTTP status code as a string.
   * @returns The recovery decision for this HTTP error.
   */
  public onHttpError(httpCode: string): IRecoveryDecision {
    this._consecutiveErrors++;
    if (isFatalHttpCode(httpCode)) {
      const log = `🛑 Telegram poll fatal error (HTTP ${httpCode}) — stopping poller`;
      getLogger().error(log);
      return { outcome: 'fatal-stop', status: 'poll-fatal-stopped' };
    }
    return this.backoffOrTrip(`HTTP ${httpCode}`);
  }

  /**
   * Classifies an exception thrown during poll(), applying backoff.
   *
   * @param error - The unknown error from the poll attempt.
   * @returns The recovery decision for this exception.
   */
  public onException(error: unknown): IRecoveryDecision {
    this._consecutiveErrors++;
    const detail = errorMessage(error);
    return this.backoffOrTrip(detail);
  }

  /**
   * Trips the circuit breaker or logs retry intent with a backoff delay.
   *
   * @param detail - Human-readable error detail for the log message.
   * @returns The circuit-breaker or retry decision.
   */
  private backoffOrTrip(detail: string): IRecoveryDecision {
    if (this._consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      const max = String(MAX_CONSECUTIVE_ERRORS);
      getLogger().error(`🛑 Telegram poll ${detail} — ${max} errors, stopping`);
      return { outcome: 'circuit-breaker-stop', status: 'poll-circuit-breaker' };
    }
    return this.logAndScheduleRetry(detail);
  }

  /**
   * Logs a retryable error and computes the exponential backoff delay.
   *
   * @param detail - Error detail for the log message.
   * @returns A retry decision carrying the backoff delay in milliseconds.
   */
  private logAndScheduleRetry(detail: string): IRecoveryDecision {
    const count = String(this._consecutiveErrors);
    const max = String(MAX_CONSECUTIVE_ERRORS);
    const seconds = backoffSeconds(this._consecutiveErrors);
    getLogger().warn(
      `⚠️  Telegram poll ${detail} (${count}/${max}) — retrying in ${seconds}s`
    );
    return {
      outcome: 'retry',
      status: 'poll-error-handled',
      sleepMs: computeBackoff(this._consecutiveErrors),
    };
  }
}
