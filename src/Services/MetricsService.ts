/**
 * Metrics collection service for tracking import performance and success rates
 */

import type { ITransactionRecord, Procedure } from '../Types/Index.js';
export type { ITransactionRecord } from '../Types/Index.js';
import { getLogger } from '../Logger/Index.js';
import { fail,succeed } from '../Types/Index.js';

export interface IAccountMetrics {
  accountNumber: string;
  accountName?: string;
  balance?: number;
  currency?: string;
  newTransactions: ITransactionRecord[];
  existingTransactions: ITransactionRecord[];
}

export interface IAccountTransactionsRecord {
  accountNumber: string;
  accountName?: string;
  balance: number | undefined;
  currency: string | undefined;
  newTransactions: ITransactionRecord[];
  existingTransactions: ITransactionRecord[];
}

export interface IBankMetrics {
  bankName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'pending' | 'success' | 'failure';
  error?: string;
  transactionsImported: number;
  transactionsSkipped: number;
  reconciliationStatus?: 'created' | 'skipped' | 'already-reconciled';
  reconciliationAmount?: number;
  accounts: IAccountMetrics[];
}

export interface IImportSummary {
  totalBanks: number;
  successfulBanks: number;
  failedBanks: number;
  totalTransactions: number;
  totalDuplicates: number;
  totalDuration: number;
  averageDuration: number;
  successRate: number;
  banks: IBankMetrics[];
}

/** Tracks per-bank import performance and aggregates import-wide statistics. */
export class MetricsService {
  private readonly _banks = new Map<string, IBankMetrics>();
  private _importStartTime = 0;

  /**
   * Marks the start of the import process and clears previous bank metrics.
   * @returns Procedure indicating the import tracking has started.
   */
  public startImport(): Procedure<{ status: 'started' }> {
    this._importStartTime = Date.now();
    this._banks.clear();
    return succeed({ status: 'started' as const });
  }

  /**
   * Starts tracking metrics for a single bank import.
   * @param bankName - The name of the bank being imported.
   * @returns Procedure indicating tracking has started for the bank.
   */
  public startBank(bankName: string): Procedure<{ status: 'tracking' }> {
    this._banks.set(bankName, {
      bankName,
      startTime: Date.now(),
      status: 'pending',
      transactionsImported: 0,
      transactionsSkipped: 0,
      accounts: []
    });
    return succeed({ status: 'tracking' as const });
  }

  /**
   * Records transaction counts for a specific account within a bank import.
   * @param bankName - The bank this account belongs to.
   * @param record - The account transaction record to append.
   * @returns Procedure indicating the account transactions were recorded.
   */
  public recordAccountTransactions(
    bankName: string, record: IAccountTransactionsRecord
  ): Procedure<{ status: 'recorded' }> {
    const metrics = this._banks.get(bankName);
    if (metrics) {
      metrics.accounts.push({ ...record });
    }
    return succeed({ status: 'recorded' as const });
  }

  /**
   * Records a successful bank import with transaction counts and duration.
   * @param bankName - The bank that was successfully imported.
   * @param transactionsImported - Number of new transactions added to Actual Budget.
   * @param transactionsSkipped - Number of duplicate transactions that were skipped.
   * @returns Procedure indicating the success was recorded.
   */
  public recordBankSuccess(
    bankName: string,
    transactionsImported: number,
    transactionsSkipped: number
  ): Procedure<{ status: 'recorded' }> {
    const metrics = this._banks.get(bankName);
    if (metrics) {
      metrics.endTime = Date.now();
      metrics.duration = metrics.endTime - metrics.startTime;
      metrics.status = 'success';
      metrics.transactionsImported = transactionsImported;
      metrics.transactionsSkipped = transactionsSkipped;
    }
    return succeed({ status: 'recorded' as const });
  }

  /**
   * Records a failed bank import with the error that caused it.
   * @param bankName - The bank whose import failed.
   * @param error - The error that caused the failure.
   * @returns Procedure indicating the failure was recorded.
   */
  public recordBankFailure(bankName: string, error: Error): Procedure<{ status: 'recorded' }> {
    const metrics = this._banks.get(bankName);
    if (metrics) {
      metrics.endTime = Date.now();
      metrics.duration = metrics.endTime - metrics.startTime;
      metrics.status = 'failure';
      metrics.error = error.message ? `${error.name}: ${error.message}` : error.name;
    }
    return succeed({ status: 'recorded' as const });
  }

  /**
   * Records the reconciliation result for a bank import.
   * @param bankName - The bank whose reconciliation result is being recorded.
   * @param status - Whether a reconciliation transaction was created, skipped, or already exists.
   * @param amount - Optional reconciliation adjustment amount in cents.
   * @returns Procedure indicating the reconciliation was recorded.
   */
  public recordReconciliation(
    bankName: string,
    status: 'created' | 'skipped' | 'already-reconciled',
    amount?: number
  ): Procedure<{ status: 'recorded' }> {
    const metrics = this._banks.get(bankName);
    if (metrics) {
      metrics.reconciliationStatus = status;
      metrics.reconciliationAmount = amount;
    }
    return succeed({ status: 'recorded' as const });
  }

  /**
   * Computes transaction and duration totals from bank metrics.
   * @param banks - Array of IBankMetrics to aggregate.
   * @returns Object with totalTransactions, totalDuplicates, and totalDuration.
   */
  private static computeTotals(banks: IBankMetrics[]): {
    totalTransactions: number;
    totalDuplicates: number;
    totalDuration: number;
  } {
    return {
      totalTransactions: banks.reduce((s, b) => s + b.transactionsImported, 0),
      totalDuplicates: banks.reduce((s, b) => s + b.transactionsSkipped, 0),
      totalDuration: banks.reduce((s, b) => s + (b.duration ?? 0), 0),
    };
  }

  /**
   * Aggregates all bank metrics into an IImportSummary.
   * @returns Procedure containing an IImportSummary with totals and per-bank breakdown.
   */
  public getSummary(): Procedure<IImportSummary> {
    const bankValues = this._banks.values();
    const banksArray = Array.from(bankValues);
    const successCount = banksArray.filter(b => b.status === 'success').length;
    const failCount = banksArray.filter(b => b.status === 'failure').length;
    const totals = MetricsService.computeTotals(banksArray);
    const avgDuration = banksArray.length > 0
      ? totals.totalDuration / banksArray.length : 0;
    const rate = banksArray.length > 0
      ? (successCount / banksArray.length) * 100 : 0;
    return succeed({
      totalBanks: banksArray.length,
      successfulBanks: successCount, failedBanks: failCount,
      ...totals, averageDuration: avgDuration,
      successRate: rate, banks: banksArray,
    });
  }

  /**
   * Logs a formatted import summary including overall stats and per-bank performance.
   * @returns Procedure indicating the summary was printed.
   */
  public printSummary(): Procedure<{ status: 'printed' }> {
    const summaryResult = this.getSummary();
    if (!summaryResult.success) return succeed({ status: 'printed' as const });
    const summary = summaryResult.data;
    const importDuration = Date.now() - this._importStartTime;
    getLogger().info(`\n${'='.repeat(60)}`);
    MetricsService.printOverallStats(summary, importDuration);
    if (summary.banks.length > 0) MetricsService.printBankPerformance(summary.banks);
    const separator = '='.repeat(60);
    getLogger().info(separator);
    return succeed({ status: 'printed' as const });
  }

  /**
   * Returns the IBankMetrics for a specific bank, if it was tracked.
   * @param bankName - The bank whose metrics to retrieve.
   * @returns Procedure containing the IBankMetrics, or failure if the bank was not tracked.
   */
  public getBankMetrics(bankName: string): Procedure<IBankMetrics> {
    const metrics = this._banks.get(bankName);
    if (!metrics) return fail('bank not found');
    return succeed(metrics);
  }

  /**
   * Returns whether any bank import has a failure status.
   * @returns Procedure containing true when at least one bank recorded a failure.
   */
  public hasFailures(): Procedure<boolean> {
    const bankValues = this._banks.values();
    const banks = Array.from(bankValues);
    const hasFailed = banks.some(b => b.status === 'failure');
    return succeed(hasFailed);
  }

  /**
   * Returns a map of error message to count for all failed banks.
   * @returns Procedure containing a record mapping each error string to occurrence count.
   */
  public getErrorBreakdown(): Procedure<Record<string, number>> {
    const breakdown: Record<string, number> = {};
    for (const bank of this._banks.values()) {
      if (bank.status === 'failure' && bank.error) {
        breakdown[bank.error] = (breakdown[bank.error] || 0) + 1;
      }
    }
    return succeed(breakdown);
  }

  /**
   * Logs overall import statistics (counts, rates, durations).
   * @param summary - The aggregated IImportSummary to display.
   * @param importDuration - Total wall-clock time of the import in milliseconds.
   */
  private static printOverallStats(summary: IImportSummary, importDuration: number): void {
    getLogger().info('📊 Import Summary\n');
    getLogger().info(`  Total banks: ${String(summary.totalBanks)}`);
    getLogger().info(
      `  Successful: ${String(summary.successfulBanks)} (${summary.successRate.toFixed(1)}%)`
    );
    getLogger().info(
      `  Failed: ${String(summary.failedBanks)} (${(100 - summary.successRate).toFixed(1)}%)`
    );
    getLogger().info(`  Total transactions: ${String(summary.totalTransactions)}`);
    getLogger().info(`  Duplicates prevented: ${String(summary.totalDuplicates)}`);
    getLogger().info(`  Total duration: ${(importDuration / 1000).toFixed(1)}s`);
    if (summary.totalBanks > 0) {
      getLogger().info(`  Average per bank: ${(summary.averageDuration / 1000).toFixed(1)}s`);
    }
  }

  /**
   * Logs per-bank performance lines including status, duration, and reconciliation.
   * @param banks - Array of IBankMetrics to display.
   */
  private static printBankPerformance(banks: IBankMetrics[]): void {
    getLogger().info('\n🏦 Bank Performance:\n');
    for (const bank of banks) {
      MetricsService.printBankLine(bank);
      if (bank.reconciliationStatus) MetricsService.printReconciliationLine(bank);
    }
  }

  /**
   * Logs a single summary line for one bank's import result.
   * @param bank - The IBankMetrics to format and log.
   */
  private static printBankLine(bank: IBankMetrics): void {
    const icon = bank.status === 'success' ? '✅' : '❌';
    const dur = bank.duration ? `${(bank.duration / 1000).toFixed(1)}s` : 'N/A';
    const detail = bank.error
      ? ` — ${bank.error}`
      : ` (${String(bank.transactionsImported)} txns, ` +
        `${String(bank.transactionsSkipped)} duplicates)`;
    getLogger().info(`  ${icon} ${bank.bankName}: ${dur}${detail}`);
  }

  /**
   * Logs the reconciliation status line beneath a bank's summary line.
   * @param bank - The IBankMetrics containing the reconciliation status to display.
   */
  private static printReconciliationLine(bank: IBankMetrics): void {
    const message = MetricsService.buildReconciliationMessage(bank);
    if (!message) return;
    getLogger().info(`     ${message}`);
  }

  /**
   * Builds the formatted reconciliation message for a bank.
   * @param bank - The IBankMetrics containing reconciliation data.
   * @returns Formatted message string, or undefined if line should be skipped.
   */
  private static buildReconciliationMessage(bank: IBankMetrics): string | undefined {
    if (bank.reconciliationStatus === 'created' && bank.reconciliationAmount === undefined) return;
    const amount = bank.reconciliationAmount ?? 0;
    const sign = amount > 0 ? '+' : '';
    const icon = bank.reconciliationStatus === 'created' ? '🔄' : '✅';
    const messages: Record<string, string> = {
      created: `${sign}${(amount / 100).toFixed(2)} ILS`,
      skipped: 'balanced',
      'already-reconciled': 'already reconciled',
    };
    return `${icon} Reconciliation: ${messages[bank.reconciliationStatus ?? '']}`;
  }

}
