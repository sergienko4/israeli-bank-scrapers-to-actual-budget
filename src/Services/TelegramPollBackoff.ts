/**
 * TelegramPollBackoff — pure helpers for the TelegramPoller error-recovery loop.
 *
 * Extracted from {@link TelegramPoller} (PR 7) so the math is independently
 * testable. No I/O, no state — every export is a pure function.
 */

const BASE_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 300_000;

/** HTTP status codes that indicate a permanent / auth failure (poller must stop). */
const FATAL_HTTP_CODES = new Set(['401', '403', '409']);

/**
 * Returns true for HTTP codes that indicate a permanent / auth failure.
 *
 * @param code - HTTP status code as a string.
 * @returns True if the poller should stop permanently rather than retry.
 */
export function isFatalHttpCode(code: string): boolean {
  return FATAL_HTTP_CODES.has(code);
}

/**
 * Computes exponential backoff in milliseconds capped at MAX_BACKOFF_MS.
 *
 * @param errorCount - Number of consecutive errors (1-based).
 * @returns Backoff duration in milliseconds.
 */
export function computeBackoff(errorCount: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** (errorCount - 1), MAX_BACKOFF_MS);
}

/**
 * Returns the backoff duration in whole seconds as a string for logging.
 *
 * @param errorCount - Number of consecutive errors (1-based).
 * @returns Backoff seconds as a string.
 */
export function backoffSeconds(errorCount: number): string {
  const ms = computeBackoff(errorCount);
  const seconds = Math.round(ms / 1000);
  return String(seconds);
}
