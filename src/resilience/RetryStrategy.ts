/**
 * Retry strategy with exponential backoff
 * Follows Single Responsibility Principle: Only handles retry logic
 */

import { ShutdownError } from '../errors/ErrorTypes.js';

export interface IRetryStrategy {
  execute<T>(fn: () => Promise<T>, operationName: string): Promise<T>;
}

export interface RetryOptions {
  maxAttempts: number;
  initialBackoffMs: number;
  onRetry?: (attempt: number, maxAttempts: number, backoffMs: number, error: Error) => void;
  shouldShutdown?: () => boolean;
}

export class ExponentialBackoffRetry implements IRetryStrategy {
  constructor(private readonly options: RetryOptions) {}

  async execute<T>(fn: () => Promise<T>, operationName: string): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      // Check for shutdown signal
      if (this.options.shouldShutdown?.()) {
        throw new ShutdownError('Operation cancelled due to shutdown');
      }

      try {
        console.log(`  🔄 Attempt ${attempt}/${this.options.maxAttempts}...`);
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Don't retry on last attempt
        if (attempt >= this.options.maxAttempts) {
          break;
        }

        // Calculate exponential backoff: 1s, 2s, 4s, 8s...
        const backoffMs = this.options.initialBackoffMs * Math.pow(2, attempt - 1);

        console.warn(`  ⚠️  ${operationName} failed (attempt ${attempt}/${this.options.maxAttempts}): ${lastError.message}`);
        console.log(`  ⏳ Retrying in ${backoffMs / 1000}s...`);

        // Call retry callback if provided
        this.options.onRetry?.(attempt, this.options.maxAttempts, backoffMs, lastError);

        // Wait before next attempt
        await this.sleep(backoffMs);
      }
    }

    throw new Error(
      `${operationName} failed after ${this.options.maxAttempts} attempts. Last error: ${lastError!.message}`
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
