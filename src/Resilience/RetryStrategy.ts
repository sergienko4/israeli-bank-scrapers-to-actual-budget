/**
 * Retry strategy with exponential backoff
 * Follows Single Responsibility Principle: Only handles retry logic
 */

import { ShutdownError } from '../Errors/ErrorTypes.js';
import { getLogger } from '../Logger/index.js';

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

export class ExponentialBackoffRetry implements IRetryStrategy {
  constructor(private readonly options: RetryOptions) {}

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

  private async handleRetryBackoff(
    attempt: number, operationName: string, error: Error
  ): Promise<void> {
    const backoffMs = this.options.initialBackoffMs * Math.pow(2, attempt - 1);
    getLogger().warn(
      `  ⚠️  ${operationName} failed ` +
      `(attempt ${attempt}/${this.options.maxAttempts}): ${error.message}`
    );
    getLogger().info(`  ⏳ Retrying in ${backoffMs / 1000}s...`);
    this.options.onRetry?.({ attempt, maxAttempts: this.options.maxAttempts, backoffMs, error });
    await this.sleep(backoffMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
