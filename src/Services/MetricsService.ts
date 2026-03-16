/**
 * Metrics collection service for tracking import performance and success rates
 */

import type { TransactionRecord } from '../Types/Index.js';
export type { TransactionRecord } from '../Types/Index.js';
import { getLogger } from '../Logger/Index.js';

export interface AccountMetrics {
  accountNumber: string;
  accountName?: string;
  balance?: number;
  currency?: string;
  newTransactions: TransactionRecord[];
  existingTransactions: TransactionRecord[];
}

export interface AccountTransactionsRecord {
  accountNumber: string;
  accountName?: string;
  balance: number | undefined;
  currency: string | undefined;
  newTransactions: TransactionRecord[];
  existingTransactions: TransactionRecord[];
}

export interface BankMetrics {
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
  accounts: AccountMetrics[];
}

export interface ImportSummary {
  totalBanks: number;
  successfulBanks: number;
  failedBanks: number;
  totalTransactions: number;
  totalDuplicates: number;
  totalDuration: number;
  averageDuration: number;
  successRate: number;
  banks: BankMetrics[];
}

/** Tracks per-bank import performance and aggregates import-wide statistics. */
export class MetricsService {
  private readonly banks: Map<string, BankMetrics> = new Map();
  private importStartTime: number = 0;

  /**
   * Marks the start of the import process and clears previous bank metrics.
   */
  startImport(): void {
    this.importStartTime = Date.now();
    this.banks.clear();
  }

  /**
   * Starts tracking metrics for a single bank import.
   * @param bankName - The name of the bank being imported.
   */
  startBank(bankName: string): void {
    this.banks.set(bankName, {
      bankName,
      startTime: Date.now(),
      status: 'pending',
      transactionsImported: 0,
      transactionsSkipped: 0,
      accounts: []
    });
  }

  /**
   * Records transaction counts for a specific account within a bank import.
   * @param bankName - The bank this account belongs to.
   * @param record - The account transaction record to append.
   */
  recordAccountTransactions(bankName: string, record: AccountTransactionsRecord): void {
    const metrics = this.banks.get(bankName);
    if (metrics) {
      metrics.accounts.push({ ...record });
    }
  }

  /**
   * Records a successful bank import with transaction counts and duration.
   * @param bankName - The bank that was successfully imported.
   * @param transactionsImported - Number of new transactions added to Actual Budget.
   * @param transactionsSkipped - Number of duplicate transactions that were skipped.
   */
  recordBankSuccess(
    bankName: string,
    transactionsImported: number,
    transactionsSkipped: number
  ): void {
    const metrics = this.banks.get(bankName);
    if (metrics) {
      metrics.endTime = Date.now();
      metrics.duration = metrics.endTime - metrics.startTime;
      metrics.status = 'success';
      metrics.transactionsImported = transactionsImported;
      metrics.transactionsSkipped = transactionsSkipped;
    }
  }

  /**
   * Records a failed bank import with the error that caused it.
   * @param bankName - The bank whose import failed.
   * @param error - The error that caused the failure.
   */
  recordBankFailure(bankName: string, error: Error): void {
    const metrics = this.banks.get(bankName);
    if (metrics) {
      metrics.endTime = Date.now();
      metrics.duration = metrics.endTime - metrics.startTime;
      metrics.status = 'failure';
      metrics.error = error.message ? `${error.name}: ${error.message}` : error.name;
    }
  }

  /**
   * Records the reconciliation result for a bank import.
   * @param bankName - The bank whose reconciliation result is being recorded.
   * @param status - Whether a reconciliation transaction was created, skipped, or already exists.
   * @param amount - Optional reconciliation adjustment amount in cents.
   */
  recordReconciliation(
    bankName: string,
    status: 'created' | 'skipped' | 'already-reconciled',
    amount?: number
  ): void {
    const metrics = this.banks.get(bankName);
    if (metrics) {
      metrics.reconciliationStatus = status;
      metrics.reconciliationAmount = amount;
    }
  }

  /**
   * Aggregates all bank metrics into an ImportSummary.
   * @returns An ImportSummary with totals and per-bank breakdown.
   */
  getSummary(): ImportSummary {
    const banksArray = Array.from(this.banks.values());
    const successfulBanks = banksArray.filter(b => b.status === 'success');
    const failedBanks = banksArray.filter(b => b.status === 'failure');

    const totalTransactions = banksArray.reduce((sum, b) => sum + b.transactionsImported, 0);
    const totalDuplicates = banksArray.reduce((sum, b) => sum + b.transactionsSkipped, 0);
    const totalDuration = banksArray.reduce((sum, b) => sum + (b.duration ?? 0), 0);

    return {
      totalBanks: banksArray.length,
      successfulBanks: successfulBanks.length,
      failedBanks: failedBanks.length,
      totalTransactions,
      totalDuplicates,
      totalDuration,
      averageDuration: banksArray.length > 0 ? totalDuration / banksArray.length : 0,
      successRate: banksArray.length > 0 ? (successfulBanks.length / banksArray.length) * 100 : 0,
      banks: banksArray
    };
  }

  /**
   * Logs a formatted import summary including overall stats and per-bank performance.
   */
  printSummary(): void {
    const summary = this.getSummary();
    const importDuration = Date.now() - this.importStartTime;
    getLogger().info(`\n${'='.repeat(60)}`);
    this.printOverallStats(summary, importDuration);
    if (summary.banks.length > 0) this.printBankPerformance(summary.banks);
    getLogger().info('='.repeat(60));
  }

  /**
   * Returns the BankMetrics for a specific bank, if it was tracked.
   * @param bankName - The bank whose metrics to retrieve.
   * @returns The BankMetrics for the bank, or undefined if not tracked.
   */
  getBankMetrics(bankName: string): BankMetrics | undefined {
    return this.banks.get(bankName);
  }

  /**
   * Returns true if any bank import has a failure status.
   * @returns True when at least one bank recorded a failure.
   */
  hasFailures(): boolean {
    return Array.from(this.banks.values()).some(b => b.status === 'failure');
  }

  /**
   * Returns a map of error message to count for all failed banks.
   * @returns Record mapping each error string to the number of banks that produced it.
   */
  getErrorBreakdown(): Record<string, number> {
    const breakdown: Record<string, number> = {};
    for (const bank of this.banks.values()) {
      if (bank.status === 'failure' && bank.error) {
        breakdown[bank.error] = (breakdown[bank.error] || 0) + 1;
      }
    }
    return breakdown;
  }

  /**
   * Logs overall import statistics (counts, rates, durations).
   * @param summary - The aggregated ImportSummary to display.
   * @param importDuration - Total wall-clock time of the import in milliseconds.
   */
  private printOverallStats(summary: ImportSummary, importDuration: number): void {
    getLogger().info('📊 Import Summary\n');
    getLogger().info(`  Total banks: ${summary.totalBanks}`);
    getLogger().info(
      `  Successful: ${summary.successfulBanks} (${summary.successRate.toFixed(1)}%)`
    );
    getLogger().info(
      `  Failed: ${summary.failedBanks} (${(100 - summary.successRate).toFixed(1)}%)`
    );
    getLogger().info(`  Total transactions: ${summary.totalTransactions}`);
    getLogger().info(`  Duplicates prevented: ${summary.totalDuplicates}`);
    getLogger().info(`  Total duration: ${(importDuration / 1000).toFixed(1)}s`);
    if (summary.totalBanks > 0) {
      getLogger().info(`  Average per bank: ${(summary.averageDuration / 1000).toFixed(1)}s`);
    }
  }

  /**
   * Logs per-bank performance lines including status, duration, and reconciliation.
   * @param banks - Array of BankMetrics to display.
   */
  private printBankPerformance(banks: BankMetrics[]): void {
    getLogger().info('\n🏦 Bank Performance:\n');
    for (const bank of banks) {
      this.printBankLine(bank);
      if (bank.reconciliationStatus) this.printReconciliationLine(bank);
    }
  }

  /**
   * Logs a single summary line for one bank's import result.
   * @param bank - The BankMetrics to format and log.
   */
  private printBankLine(bank: BankMetrics): void {
    const icon = bank.status === 'success' ? '✅' : '❌';
    const dur = bank.duration ? `${(bank.duration / 1000).toFixed(1)}s` : 'N/A';
    const detail = bank.error
      ? ` — ${bank.error}`
      : ` (${bank.transactionsImported} txns, ${bank.transactionsSkipped} duplicates)`;
    getLogger().info(`  ${icon} ${bank.bankName}: ${dur}${detail}`);
  }

  /**
   * Logs the reconciliation status line beneath a bank's summary line.
   * @param bank - The BankMetrics containing the reconciliation status to display.
   */
  private printReconciliationLine(bank: BankMetrics): void {
    if (bank.reconciliationStatus === 'created' && bank.reconciliationAmount === undefined) {
      return;
    }
    const reconIcon = bank.reconciliationStatus === 'created' ? '🔄' : '✅';
    const hasPositiveAmount = bank.reconciliationAmount !== undefined
      && bank.reconciliationAmount > 0;
    const sign = hasPositiveAmount ? '+' : '';
    const reconMessages: Record<string, string> = {
      created: bank.reconciliationAmount === undefined
        ? ''
        : `${sign}${(bank.reconciliationAmount / 100).toFixed(2)} ILS`,
      skipped: 'balanced',
      'already-reconciled': 'already reconciled',
    };
    getLogger().info(
      `     ${reconIcon} Reconciliation: ${reconMessages[bank.reconciliationStatus ?? '']}`
    );
  }

}
