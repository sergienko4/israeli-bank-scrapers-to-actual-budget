/**
 * Importer resilience-components wiring.
 *
 * Second seam extracted from src/Index.ts during the composition-root
 * decoupling refactor. Constructs and returns the five resilience
 * primitives the pipeline depends on:
 *   - GracefulShutdownHandler — signal-aware shutdown flag
 *   - ExponentialBackoffRetry (default) — pipeline-grade retry with WAF
 *     block detection and shutdown-aware abort
 *   - ExponentialBackoffRetry (no-retry) — single-attempt strategy for
 *     code paths that must not retry but want the shared interface
 *   - TimeoutWrapper — bounded-await helper
 *   - ErrorFormatter — user-facing error rendering
 *
 * The two retry strategies close over the shared shutdown handler so
 * the shouldShutdown predicate observes the same in-process signal.
 */

import { ErrorFormatter } from '../Errors/ErrorFormatter.js';
import { GracefulShutdownHandler } from '../Resilience/GracefulShutdown.js';
import { ExponentialBackoffRetry } from '../Resilience/RetryStrategy.js';
import { TimeoutWrapper } from '../Resilience/TimeoutWrapper.js';
import { DEFAULT_RESILIENCE_CONFIG } from '../Types/Index.js';

/**
 * Bundle of resilience primitives passed downstream into wiring + pipeline.
 */
export interface IResilienceComponents {
  readonly shutdownHandler: GracefulShutdownHandler;
  readonly retryStrategy: ExponentialBackoffRetry;
  readonly noRetryStrategy: ExponentialBackoffRetry;
  readonly timeoutWrapper: TimeoutWrapper;
  readonly errorFormatter: ErrorFormatter;
}

/**
 * Builds the default ExponentialBackoffRetry tuned for live bank scrapes.
 *
 * Uses DEFAULT_RESILIENCE_CONFIG for attempt count and backoff, observes
 * the shared shutdown handler so retries abort on SIGTERM/SIGINT, and
 * declines to retry WAF-block errors (which require manual intervention).
 *
 * @param shutdownHandler - Shared handler whose flag terminates retries.
 * @returns Configured retry strategy.
 */
function buildRetryStrategy(shutdownHandler: GracefulShutdownHandler): ExponentialBackoffRetry {
  return new ExponentialBackoffRetry({
    maxAttempts: DEFAULT_RESILIENCE_CONFIG.maxRetryAttempts,
    initialBackoffMs: DEFAULT_RESILIENCE_CONFIG.initialBackoffMs,
    /**
     * Returns whether the shutdown handler is active.
     * @returns True once a shutdown signal has been received.
     */
    shouldShutdown: (): boolean => shutdownHandler.isShuttingDown(),
    /**
     * Returns false for WAF block errors so they are not retried.
     * @param error - The error from the failed attempt.
     * @returns True to retry, false for WAF blocks.
     */
    shouldRetry: (error: Error): boolean => error.name !== 'WafBlockError',
  });
}

/**
 * Builds a single-attempt retry strategy that shares the shutdown signal.
 *
 * Used by code paths that must not retry (e.g. notification side effects)
 * but want the same shouldShutdown semantics for consistency.
 *
 * @param shutdownHandler - Shared handler whose flag terminates retries.
 * @returns Single-attempt retry strategy.
 */
function buildNoRetryStrategy(shutdownHandler: GracefulShutdownHandler): ExponentialBackoffRetry {
  return new ExponentialBackoffRetry({
    maxAttempts: 1,
    initialBackoffMs: 0,
    /**
     * Returns whether the shutdown handler is active.
     * @returns True once a shutdown signal has been received.
     */
    shouldShutdown: (): boolean => shutdownHandler.isShuttingDown(),
  });
}

/**
 * Constructs and returns the five resilience components the importer needs.
 *
 * The returned bundle is intended for direct destructuring into the wiring
 * + pipeline stages — every consumer gets exactly the primitives it needs
 * with no implicit globals.
 *
 * @returns The IResilienceComponents bundle.
 */
export function buildResilienceComponents(): IResilienceComponents {
  const shutdownHandler = new GracefulShutdownHandler();
  return {
    shutdownHandler,
    retryStrategy: buildRetryStrategy(shutdownHandler),
    noRetryStrategy: buildNoRetryStrategy(shutdownHandler),
    timeoutWrapper: new TimeoutWrapper(),
    errorFormatter: new ErrorFormatter(),
  };
}
