/**
 * Retry strategy with exponential backoff
 * Follows Single Responsibility Principle: Only handles retry logic
 */

import { ShutdownError } from '../Errors/ErrorTypes.js';
import { getLogger } from '../Logger/Index.js';
import type { Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import { errorMessage, repeatWhile } from '../Utils/Index.js';

export interface IRetryStrategy {
  execute<T>(fn: () => Promise<T>, operationName: string): Promise<T>;
}

export interface IRetryContext {
  attempt: number;
  maxAttempts: number;
  backoffMs: number;
  error: Error;
}

export interface IRetryOptions {
  maxAttempts: number;
  initialBackoffMs: number;
  onRetry?: (ctx: IRetryContext) => Procedure<{ status: string }>;
  shouldShutdown?: () => boolean;
  shouldRetry?: (error: Error) => boolean;
}

/** Outcome of a single retry attempt: success carries data, failure carries the error. */
type AttemptResult<T> =
  | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: Error };

/** Retries an async operation with exponential backoff until success or max attempts. */
export class ExponentialBackoffRetry implements IRetryStrategy {
  /**
   * Creates an ExponentialBackoffRetry with the given options.
   * @param options - Retry configuration including attempts, backoff, and hooks.
   */
  constructor(private readonly options: IRetryOptions) {}

  /**
   * Executes the given function, retrying on failure with exponential backoff.
   * @param fn - Async function to execute and retry.
   * @param operationName - Human-readable label used in log messages.
   * @returns The resolved value from fn on success.
   */
  public async execute<T>(fn: () => Promise<T>, operationName: string): Promise<T> {
    /**
     * Runs one attempt of fn.
     * @param attempt - The 1-based attempt number.
     * @returns The attempt's outcome.
     */
    const attemptOnce = (attempt: number): Promise<AttemptResult<T>> =>
      this.tryOneAttempt(fn, operationName, attempt);
    const outcome = await this.attemptUntilSettled(attemptOnce);
    if (outcome.success) return outcome.data;
    throw this.exhaustedError(operationName, outcome.error);
  }

  /**
   * Builds the error thrown once every attempt failed. The last attempt's own
   * error rides along as the cause, so a caller can still tell what failed.
   * @param operationName - Human-readable label used in the message.
   * @param lastError - The error the last attempt failed with.
   * @returns The ShutdownError to throw.
   */
  private exhaustedError(operationName: string, lastError: Error): ShutdownError {
    const attempts = String(this.options.maxAttempts);
    return new ShutdownError(
      `${operationName} failed after ${attempts} attempts. Last error: ${lastError.message}`,
      { cause: lastError },
    );
  }

  /**
   * Runs the first attempt, then retries one attempt at a time while the
   * latest one failed and the attempt budget is not yet used up.
   * @param attemptOnce - Runs one attempt with the given 1-based number.
   * @returns The successful outcome, or the last failure once attempts run out.
   */
  private async attemptUntilSettled<T>(
    attemptOnce: (attempt: number) => Promise<AttemptResult<T>>
  ): Promise<AttemptResult<T>> {
    let attempt = 1;
    let outcome = await attemptOnce(attempt);
    /**
     * Reports whether another attempt should start.
     * @returns True while the latest attempt failed and attempts remain.
     */
    const mayRetry = (): boolean => !outcome.success && attempt < this.options.maxAttempts;
    const retries = repeatWhile(mayRetry, () => attemptOnce(++attempt));
    for await (const next of retries) outcome = next;
    return outcome;
  }

  /**
   * Executes a single attempt and handles failure with backoff if not the last attempt.
   * @param fn - Async function to execute.
   * @param operationName - Label for log messages.
   * @param attempt - Current attempt number (1-based).
   * @returns Object with success flag, data on success, or error on failure.
   */
  private async tryOneAttempt<T>(
    fn: () => Promise<T>, operationName: string, attempt: number
  ): Promise<AttemptResult<T>> {
    if (this.options.shouldShutdown?.()) throw new ShutdownError('cancelled due to shutdown');
    try {
      return await this.runOnce(fn, attempt);
    } catch (error: unknown) {
      return await this.handleAttemptError<T>(error, operationName, attempt);
    }
  }

  /**
   * Executes the operation once and wraps the resolved value as a success result.
   * @param fn - Async function to execute.
   * @param attempt - Current attempt number (1-based), used in the log line.
   * @returns A success result carrying the resolved value.
   */
  private async runOnce<T>(fn: () => Promise<T>, attempt: number): Promise<AttemptResult<T>> {
    getLogger().info(`  🔄 Attempt ${String(attempt)}/${String(this.options.maxAttempts)}...`);
    const data = await fn();
    return { success: true, data };
  }

  /**
   * Converts a thrown value into a failure result, applying retry policy and backoff.
   * @param error - The thrown value from the failed attempt.
   * @param operationName - Label for log messages.
   * @param attempt - Current attempt number (1-based).
   * @returns A failure result carrying the normalized error.
   */
  private async handleAttemptError<T>(
    error: unknown, operationName: string, attempt: number
  ): Promise<AttemptResult<T>> {
    const lastError = error instanceof Error ? error : new Error(errorMessage(error));
    if (attempt >= this.options.maxAttempts) return { success: false, error: lastError };
    if (this.options.shouldRetry && !this.options.shouldRetry(lastError)) throw lastError;
    await this.handleRetryBackoff(attempt, operationName, lastError);
    return { success: false, error: lastError };
  }

  /**
   * Logs the failure, waits for the computed backoff period, and fires the onRetry hook.
   * @param attempt - Current attempt number (1-based).
   * @param operationName - Label for log messages.
   * @param error - The error from the failed attempt.
   * @returns Procedure indicating the backoff delay has completed.
   */
  private async handleRetryBackoff(
    attempt: number, operationName: string, error: Error
  ): Promise<Procedure<{ status: string }>> {
    const backoffMs = this.options.initialBackoffMs * 2 ** (attempt - 1);
    this.logRetryWarning(attempt, operationName, error);
    getLogger().info(`  ⏳ Retrying in ${String(backoffMs / 1000)}s...`);
    this.options.onRetry?.({ attempt, maxAttempts: this.options.maxAttempts, backoffMs, error });
    await ExponentialBackoffRetry.sleep(backoffMs);
    return succeed({ status: 'backoff-complete' });
  }

  /**
   * Logs a warning describing the failed attempt and its error.
   * @param attempt - Current attempt number (1-based).
   * @param operationName - Label for the log message.
   * @param error - The error from the failed attempt.
   * @returns Nothing.
   */
  private logRetryWarning(attempt: number, operationName: string, error: Error): void {
    getLogger().warn(
      `  ⚠️  ${operationName} failed ` +
      `(attempt ${String(attempt)}/${String(this.options.maxAttempts)}): ${error.message}`
    );
  }

  /**
   * Pauses execution for the given duration.
   * @param ms - Duration in milliseconds to wait.
   * @returns A promise that resolves after the specified delay.
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise<void>(resolve => {
      const timer = ms;
      globalThis.setTimeout(resolve, timer);
    });
  }
}
