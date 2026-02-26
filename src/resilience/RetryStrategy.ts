/**
 * Retry strategy with exponential backoff
 * Follows Single Responsibility Principle: Only handles retry logic
 */

import { ShutdownError } from '../errors/ErrorTypes.js';
import { getLogger } from '../logger/index.js';

export interface IRetryStrategy {
  execute<T>(fn: () => Promise<T>, operationName: string): Promise<T>;
}

export interface RetryOptions {
  maxAttempts: number;
  initialBackoffMs: number;
  onRetry?: (attempt: number, maxAttempts: number, backoffMs: number, error: Error) => void;
  shouldShutdown?: () => boolean;
  shouldRetry?: (error: Error) => boolean;
}

export class ExponentialBackoffRetry implements IRetryStrategy {
  constructor(private readonly options: RetryOptions) {}

  async execute<T>(fn: () => Promise<T>, operationName: string): Promise<T> {
    let lastError: Error;
    let actualAttempts = 0;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      if (this.options.shouldShutdown?.()) throw new ShutdownError('Operation cancelled due to shutdown');
      try {
        getLogger().info(`  🔄 Attempt ${attempt}/${this.options.maxAttempts}...`);
        actualAttempts = attempt;
        return await fn();
      } catch (error) {
        lastError = error as Error;
        if (attempt >= this.options.maxAttempts) break;
        if (this.options.shouldRetry && !this.options.shouldRetry(lastError)) throw lastError;
        await this.handleRetryBackoff(attempt, operationName, lastError);
      }
    }

    throw new Error(`${operationName} failed after ${actualAttempts} attempts. Last error: ${lastError!.message}`);
  }

  private async handleRetryBackoff(attempt: number, operationName: string, error: Error): Promise<void> {
    const backoffMs = this.options.initialBackoffMs * Math.pow(2, attempt - 1);
    getLogger().warn(`  ⚠️  ${operationName} failed (attempt ${attempt}/${this.options.maxAttempts}): ${error.message}`);
    getLogger().info(`  ⏳ Retrying in ${backoffMs / 1000}s...`);
    this.options.onRetry?.(attempt, this.options.maxAttempts, backoffMs, error);
    await this.sleep(backoffMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
