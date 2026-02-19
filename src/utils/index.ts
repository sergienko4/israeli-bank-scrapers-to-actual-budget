export { toCents, fromCents } from './currency.js';
export { formatDate } from './date.js';

/** Safely extract .data from Actual Budget runQuery() result (returns unknown) */
export function extractQueryData<T>(result: unknown, fallback: T): T {
  const obj = result as { data?: T } | null;
  return obj?.data ?? fallback;
}

/** Extract error message from unknown catch value */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
