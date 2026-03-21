/**
 * Retry strategy with exponential backoff
 * Follows Single Responsibility Principle: Only handles retry logic
 */

import { ShutdownError } from '../Errors/ErrorTypes.js';
import { getLogger } from '../Logger/Index.js';
import type { Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';

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
    return this.executeAttempt(fn, operationName, 1);
  }

  /**
   * Recursively attempts to execute the function, retrying on failure.
   * @param fn - Async function to execute.
   * @param operationName - Human-readable label for logs.
   * @param attempt - Current attempt number (1-based).
   * @returns The resolved value from fn on success.
   */
  private async executeAttempt<T>(
    fn: () => Promise<T>, operationName: string, attempt: number
  ): Promise<T> {
    const result = await this.tryOneAttempt(fn, operationName, attempt);
    if (result.success) return result.data;
    if (attempt >= this.options.maxAttempts) {
      throw new ShutdownError(
        `${operationName} failed after ${String(this.options.maxAttempts)} attempts. ` +
        `Last error: ${result.error.message}`
      );
    }
    return this.executeAttempt(fn, operationName, attempt + 1);
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
  ): Promise<
    { success: true; data: T; error?: never } |
    { success: false; data?: never; error: Error }
  > {
    if (this.options.shouldShutdown?.()) throw new ShutdownError('cancelled due to shutdown');
    try {
      getLogger().info(`  🔄 Attempt ${String(attempt)}/${String(this.options.maxAttempts)}...`);
      const data = await fn();
      return { success: true, data };
    } catch (error) {
      const lastError = error as Error;
      if (attempt >= this.options.maxAttempts) return { success: false, error: lastError };
      if (this.options.shouldRetry && !this.options.shouldRetry(lastError)) throw lastError;
      await this.handleRetryBackoff(attempt, operationName, lastError);
      return { success: false, error: lastError };
    }
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
    getLogger().warn(
      `  ⚠️  ${operationName} failed ` +
      `(attempt ${String(attempt)}/${String(this.options.maxAttempts)}): ${error.message}`
    );
    getLogger().info(`  ⏳ Retrying in ${String(backoffMs / 1000)}s...`);
    this.options.onRetry?.({ attempt, maxAttempts: this.options.maxAttempts, backoffMs, error });
    await ExponentialBackoffRetry.sleep(backoffMs);
    return succeed({ status: 'backoff-complete' });
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
