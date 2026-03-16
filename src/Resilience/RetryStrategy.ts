/**
 * Retry strategy with exponential backoff
 * Follows Single Responsibility Principle: Only handles retry logic
 */

import { ShutdownError } from '../Errors/ErrorTypes.js';
import { getLogger } from '../Logger/Index.js';

export interface IRetryStrategy {
  execute<T>(fn: () => Promise<T>, operationName: string): Promise<T>;
}

export interface RetryContext {
  attempt: number;
  maxAttempts: number;
  backoffMs: number;
  error: Error;
}

export interface RetryOptions {
  maxAttempts: number;
  initialBackoffMs: number;
  onRetry?: (ctx: RetryContext) => void;
  shouldShutdown?: () => boolean;
  shouldRetry?: (error: Error) => boolean;
}

/** Retries an async operation with exponential backoff until success or max attempts. */
export class ExponentialBackoffRetry implements IRetryStrategy {
  /**
   * Creates an ExponentialBackoffRetry with the given options.
   * @param options - Retry configuration including attempts, backoff, and hooks.
   */
  constructor(private readonly options: RetryOptions) {}

  /**
   * Executes the given function, retrying on failure with exponential backoff.
   * @param fn - Async function to execute and retry.
   * @param operationName - Human-readable label used in log messages.
   * @returns The resolved value from fn on success.
   */
  async execute<T>(fn: () => Promise<T>, operationName: string): Promise<T> {
    let lastError!: Error;
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      if (this.options.shouldShutdown?.()) throw new ShutdownError('cancelled due to shutdown');
      try {
        getLogger().info(`  🔄 Attempt ${attempt}/${this.options.maxAttempts}...`);
        return await fn();
      } catch (error) {
        lastError = error as Error;
        if (attempt >= this.options.maxAttempts) break;
        if (this.options.shouldRetry && !this.options.shouldRetry(lastError)) throw lastError;
        await this.handleRetryBackoff(attempt, operationName, lastError);
      }
    }
    throw new Error(
      `${operationName} failed after ${this.options.maxAttempts} attempts. ` +
      `Last error: ${lastError.message}`
    );
  }

  /**
   * Logs the failure, waits for the computed backoff period, and fires the onRetry hook.
   * @param attempt - Current attempt number (1-based).
   * @param operationName - Label for log messages.
   * @param error - The error from the failed attempt.
   */
  private async handleRetryBackoff(
    attempt: number, operationName: string, error: Error
  ): Promise<void> {
    const backoffMs = this.options.initialBackoffMs * 2 ** (attempt - 1);
    getLogger().warn(
      `  ⚠️  ${operationName} failed ` +
      `(attempt ${attempt}/${this.options.maxAttempts}): ${error.message}`
    );
    getLogger().info(`  ⏳ Retrying in ${backoffMs / 1000}s...`);
    this.options.onRetry?.({ attempt, maxAttempts: this.options.maxAttempts, backoffMs, error });
    await this.sleep(backoffMs);
  }

  /**
   * Pauses execution for the given duration.
   * @param ms - Duration in milliseconds to wait.
   * @returns A promise that resolves after the specified delay.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
