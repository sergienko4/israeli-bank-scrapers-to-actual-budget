/**
 * Serializes metrics summaries into logger output.
 *
 * @internal
 */
import { getLogger, type ILogger } from '../../Logger/Index.js';
import type { IBankMetrics, IImportSummary } from './Types.js';
const SEPARATOR = '='.repeat(60);
/** Prints summary.
 * @param summary import summary.
 * @param importDuration duration.
 * @returns printed flag. */
export function printImportSummary(summary: IImportSummary, importDuration: number): boolean {
  const logger = getLogger();
  logger.info(`\n${SEPARATOR}`);
  printOverallStats(logger, summary, importDuration);
  if (summary.banks.length > 0) printBankPerformance(logger, summary.banks);
  logger.info(SEPARATOR);
  return true;
}
/** Builds reconciliation text.
 * @param bank bank metrics.
 * @returns reconciliation text. */
export function buildReconciliationMessage(bank: IBankMetrics): string {
  if (bank.reconciliationStatus === 'created' && bank.reconciliationAmount === undefined) return '';
  const icon = bank.reconciliationStatus === 'created' ? '🔄' : '✅';
  const text = reconciliationText(bank);
  return `${icon} Reconciliation: ${text}`;
}
/** Prints totals.
 * @param logger logger.
 * @param summary summary.
 * @param importDuration duration.
 * @returns printed flag. */
function printOverallStats(
  logger: ILogger, summary: IImportSummary, importDuration: number
): boolean {
  logger.info('📊 Import Summary\n');
  printBankCounts(logger, summary);
  printTransactionCounts(logger, summary);
  printDurationStats(logger, summary, importDuration);
  return true;
}
/** Prints bank counts.
 * @param logger logger.
 * @param summary summary.
 * @returns printed flag. */
function printBankCounts(logger: ILogger, summary: IImportSummary): boolean {
  const successfulBanks = String(summary.successfulBanks);
  const failedBanks = String(summary.failedBanks);
  const successRate = summary.successRate.toFixed(1);
  const failureRate = (100 - summary.successRate).toFixed(1);
  logger.info(`  Total banks: ${String(summary.totalBanks)}`);
  logger.info(`  Successful: ${successfulBanks} (${successRate}%)`);
  logger.info(`  Failed: ${failedBanks} (${failureRate}%)`);
  return true;
}
/** Prints transaction counts.
 * @param logger logger.
 * @param summary summary.
 * @returns printed flag. */
function printTransactionCounts(logger: ILogger, summary: IImportSummary): boolean {
  const totalTransactions = String(summary.totalTransactions);
  const totalDuplicates = String(summary.totalDuplicates);
  logger.info(`  Total transactions: ${totalTransactions}`);
  logger.info(`  Duplicates prevented: ${totalDuplicates}`);
  return true;
}
/** Prints durations.
 * @param logger logger.
 * @param summary summary.
 * @param importDuration duration.
 * @returns printed flag. */
function printDurationStats(
  logger: ILogger, summary: IImportSummary, importDuration: number
): boolean {
  const totalDuration = (importDuration / 1000).toFixed(1);
  const average = (summary.averageDuration / 1000).toFixed(1);
  logger.info(`  Total duration: ${totalDuration}s`);
  if (summary.totalBanks > 0) logger.info(`  Average per bank: ${average}s`);
  return true;
}
/** Prints banks.
 * @param logger logger.
 * @param banks bank metrics.
 * @returns printed flag. */
function printBankPerformance(logger: ILogger, banks: IBankMetrics[]): boolean {
  logger.info('\n🏦 Bank Performance:\n');
  for (const bank of banks) {
    printBankLine(logger, bank);
    printReconciliationLine(logger, bank);
  }
  return true;
}
/** Prints bank line.
 * @param logger logger.
 * @param bank bank metrics.
 * @returns printed flag. */
function printBankLine(logger: ILogger, bank: IBankMetrics): boolean {
  const icon = bank.status === 'success' ? '✅' : '❌';
  const duration = bank.duration ? `${(bank.duration / 1000).toFixed(1)}s` : 'N/A';
  const detail = bankDetail(bank);
  logger.info(`  ${icon} ${bank.bankName}: ${duration}${detail}`);
  return true;
}
/** Prints reconciliation line.
 * @param logger logger.
 * @param bank bank metrics.
 * @returns printed flag. */
function printReconciliationLine(logger: ILogger, bank: IBankMetrics): boolean {
  if (!bank.reconciliationStatus) return false;
  const message = buildReconciliationMessage(bank);
  if (message) logger.info(`     ${message}`);
  return Boolean(message);
}
/** Formats bank detail.
 * @param bank bank metrics.
 * @returns detail. */
function bankDetail(bank: IBankMetrics): string {
  if (bank.error) return ` — ${bank.error}`;
  const txns = ` (${String(bank.transactionsImported)} txns, `;
  return `${txns}${String(bank.transactionsSkipped)} duplicates)`;
}
/** Selects text.
 * @param bank bank metrics.
 * @returns text. */
function reconciliationText(bank: IBankMetrics): string {
  if (bank.reconciliationStatus === 'created') return reconciliationAmount(bank);
  if (bank.reconciliationStatus === 'skipped') return 'balanced';
  return 'already reconciled';
}
/** Formats amount.
 * @param bank bank metrics.
 * @returns amount text. */
function reconciliationAmount(bank: IBankMetrics): string {
  const amount = bank.reconciliationAmount ?? 0;
  const formattedAmount = (amount / 100).toFixed(2);
  return `${amount > 0 ? '+' : ''}${formattedAmount} ILS`;
}
