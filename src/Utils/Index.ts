export { fromCents,toCents } from './Currency.js';
export { filterByDateCutoff,formatDate } from './Date.js';

import logger from './UtilLogger.js';

/**
 * Safely extract .data from Actual Budget runQuery() result (returns unknown).
 * @param result - The raw result returned by runQuery (typed as unknown).
 * @param fallback - Value to return when data is absent or null.
 * @returns The extracted data, or the fallback if unavailable.
 */
export function extractQueryData<T>(result: unknown, fallback: T): T {
  logger.debug('extractQueryData');
  const obj = result as { data?: T } | null;
  return obj?.data ?? fallback;
}

/**
 * Extract a string message from an unknown catch value.
 * @param error - The unknown value caught in a catch block.
 * @returns The error message string, or the stringified value.
 */
export function errorMessage(error: unknown): string {
  logger.debug('errorMessage');
  return error instanceof Error ? error.message : String(error);
}
