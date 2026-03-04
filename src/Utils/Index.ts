export { toCents, fromCents } from './Currency.js';
export { formatDate, filterByDateCutoff } from './Date.js';

/** Safely extract .data from Actual Budget runQuery() result (returns unknown) */
// eslint-disable-next-line no-restricted-syntax -- pure extraction helper, called per-transaction
export function extractQueryData<T>(result: unknown, fallback: T): T {
  const obj = result as { data?: T } | null;
  return obj?.data ?? fallback;
}

/** Extract error message from unknown catch value */
// eslint-disable-next-line no-restricted-syntax -- pure error unwrapper
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
