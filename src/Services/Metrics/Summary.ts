/**
 * Aggregates per-bank metrics into import summaries.
 *
 * @internal
 */
import type { IBankMetrics, IImportSummary } from './Types.js';
interface ISummaryCounts { success: number; failure: number }
interface ISummaryTotals {
  totalTransactions: number;
  totalDuplicates: number;
  totalDuration: number;
}
/** Builds the import summary.
 * @param banks bank metrics.
 * @returns import summary. */
export default function buildImportSummary(banks: IBankMetrics[]): IImportSummary {
  const counts = countBanks(banks);
  const totals = computeTotals(banks);
  return createImportSummary(banks, counts, totals);
}
/** Creates summary payload.
 * @param banks bank metrics.
 * @param counts outcome counts.
 * @param totals summary totals.
 * @returns import summary. */
function createImportSummary(
  banks: IBankMetrics[], counts: ISummaryCounts, totals: ISummaryTotals
): IImportSummary {
  const totalBanks = banks.length;
  const average = averageDuration(totalBanks, totals.totalDuration);
  const rate = successRate(totalBanks, counts.success);
  return { totalBanks, successfulBanks: counts.success, failedBanks: counts.failure,
    ...totals, averageDuration: average, successRate: rate, banks };
}
/** Counts outcomes.
 * @param banks bank metrics.
 * @returns outcome counts. */
function countBanks(banks: IBankMetrics[]): ISummaryCounts {
  const success = countByStatus(banks, 'success');
  const failure = countByStatus(banks, 'failure');
  return { success, failure };
}
/** Counts one status.
 * @param banks bank metrics.
 * @param status target status.
 * @returns matching count. */
function countByStatus(banks: IBankMetrics[], status: IBankMetrics['status']): number {
  return banks.filter(bank => bank.status === status).length;
}
/** Computes totals.
 * @param banks bank metrics.
 * @returns summary totals. */
function computeTotals(banks: IBankMetrics[]): ISummaryTotals {
  const initialTotals = zeroTotals();
  return banks.reduce((totals, bank) => addBankTotals(totals, bank), initialTotals);
}
/** Adds bank totals.
 * @param totals prior totals.
 * @param bank bank metrics.
 * @returns next totals. */
function addBankTotals(totals: ISummaryTotals, bank: IBankMetrics): ISummaryTotals {
  return {
    totalTransactions: totals.totalTransactions + bank.transactionsImported,
    totalDuplicates: totals.totalDuplicates + bank.transactionsSkipped,
    totalDuration: totals.totalDuration + (bank.duration ?? 0),
  };
}
/** Returns zero totals.
 * @returns zero totals. */
function zeroTotals(): ISummaryTotals {
  return { totalTransactions: 0, totalDuplicates: 0, totalDuration: 0 };
}
/** Averages duration.
 * @param totalBanks bank count.
 * @param totalDuration duration sum.
 * @returns average duration. */
function averageDuration(totalBanks: number, totalDuration: number): number {
  return totalBanks > 0 ? totalDuration / totalBanks : 0;
}
/** Calculates success rate.
 * @param totalBanks bank count.
 * @param successfulBanks success count.
 * @returns success rate. */
function successRate(totalBanks: number, successfulBanks: number): number {
  return totalBanks > 0 ? (successfulBanks / totalBanks) * 100 : 0;
}
