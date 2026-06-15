/**
 * Plain structured-JSON webhook payload formatters.
 * Renders summary, error, and message events as machine-readable JSON.
 */
import type { IBankMetrics, IImportSummary } from '../../MetricsService.js';

/** Plain JSON shape for a single serialized bank result. */
interface IPlainBank {
  name: string;
  status: string;
  transactions: number;
  error?: string;
}

/**
 * Serializes one bank result as a plain JSON object.
 * @param b - The IBankMetrics to serialize.
 * @returns Object with name, status, transaction count, and optional error.
 */
function plainBank(b: IBankMetrics): IPlainBank {
  return {
    name: b.bankName, status: b.status,
    transactions: b.transactionsImported, error: b.error,
  };
}

/**
 * Formats the import summary as a plain structured JSON event payload.
 * @param summary - The ImportSummary to serialize.
 * @returns JSON string with an `event: 'import_complete'` payload.
 */
export function plainSummary(summary: IImportSummary): string {
  return JSON.stringify({
    event: 'import_complete',
    totalBanks: summary.totalBanks, successfulBanks: summary.successfulBanks,
    failedBanks: summary.failedBanks, totalTransactions: summary.totalTransactions,
    totalDuplicates: summary.totalDuplicates, duration: summary.totalDuration,
    successRate: summary.successRate, banks: summary.banks.map(plainBank),
  });
}

/**
 * Formats an error message as a plain JSON event payload.
 * @param error - The error message to include.
 * @returns JSON string with an `event: 'error'` payload.
 */
export function plainError(error: string): string {
  return JSON.stringify({ event: 'error', message: error });
}

/**
 * Formats a plain message as a plain JSON event payload.
 * @param text - The message text to include.
 * @returns JSON string with an `event: 'message'` payload.
 */
export function plainMessage(text: string): string {
  return JSON.stringify({ event: 'message', message: text });
}
