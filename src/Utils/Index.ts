export { toCents, fromCents } from './Currency.js';
export { formatDate, filterByDateCutoff } from './Date.js';

/**
 * Safely extract .data from Actual Budget runQuery() result (returns unknown).
 * @param result - The raw result returned by runQuery (typed as unknown).
 * @param fallback - Value to return when data is absent or null.
 * @returns The extracted data, or the fallback if unavailable.
 */
// eslint-disable-next-line no-restricted-syntax -- pure extraction helper, called per-transaction
export function extractQueryData<T>(result: unknown, fallback: T): T {
  const obj = result as { data?: T } | null;
  return obj?.data ?? fallback;
}

/**
 * Extract a string message from an unknown catch value.
 * @param error - The unknown value caught in a catch block.
 * @returns The error message string, or the stringified value.
 */
// eslint-disable-next-line no-restricted-syntax -- pure error unwrapper
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
