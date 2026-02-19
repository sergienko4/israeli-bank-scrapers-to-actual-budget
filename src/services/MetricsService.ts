/**
 * Metrics collection service for tracking import performance and success rates
 */

import { TransactionRecord } from '../types/index.js';

export { TransactionRecord };

export interface AccountMetrics {
  accountNumber: string;
  balance?: number;
  currency?: string;
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

export class MetricsService {
  private banks: Map<string, BankMetrics> = new Map();
  private importStartTime: number = 0;

  /**
   * Mark the start of the import process
   */
  startImport(): void {
    this.importStartTime = Date.now();
    this.banks.clear();
  }

  /**
   * Start tracking a bank import
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
   * Record account transactions for a bank
   */
  recordAccountTransactions(
    bankName: string,
    accountNumber: string,
    balance: number | undefined,
    currency: string | undefined,
    newTransactions: TransactionRecord[],
    existingTransactions: TransactionRecord[]
  ): void {
    const metrics = this.banks.get(bankName);
    if (metrics) {
      metrics.accounts.push({ accountNumber, balance, currency, newTransactions, existingTransactions });
    }
  }

  /**
   * Record bank import success
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
   * Record bank import failure
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
   * Record reconciliation result
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
   * Get summary of all metrics
   */
  getSummary(): ImportSummary {
    const banksArray = Array.from(this.banks.values());
    const successfulBanks = banksArray.filter(b => b.status === 'success');
    const failedBanks = banksArray.filter(b => b.status === 'failure');

    const totalTransactions = banksArray.reduce((sum, b) => sum + b.transactionsImported, 0);
    const totalDuplicates = banksArray.reduce((sum, b) => sum + b.transactionsSkipped, 0);
    const totalDuration = banksArray.reduce((sum, b) => sum + (b.duration || 0), 0);

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
   * Print formatted summary to console
   */
  printSummary(): void {
    const summary = this.getSummary();
    const importDuration = Date.now() - this.importStartTime;
    console.log('\n' + '='.repeat(60));
    this.printOverallStats(summary, importDuration);
    if (summary.banks.length > 0) this.printBankPerformance(summary.banks);
    console.log('='.repeat(60));
  }

  private printOverallStats(summary: ImportSummary, importDuration: number): void {
    console.log('📊 Import Summary\n');
    console.log(`  Total banks: ${summary.totalBanks}`);
    console.log(`  Successful: ${summary.successfulBanks} (${summary.successRate.toFixed(1)}%)`);
    console.log(`  Failed: ${summary.failedBanks} (${(100 - summary.successRate).toFixed(1)}%)`);
    console.log(`  Total transactions: ${summary.totalTransactions}`);
    console.log(`  Duplicates prevented: ${summary.totalDuplicates}`);
    console.log(`  Total duration: ${(importDuration / 1000).toFixed(1)}s`);
    if (summary.totalBanks > 0) console.log(`  Average per bank: ${(summary.averageDuration / 1000).toFixed(1)}s`);
  }

  private printBankPerformance(banks: BankMetrics[]): void {
    console.log('\n🏦 Bank Performance:\n');
    for (const bank of banks) {
      const icon = bank.status === 'success' ? '✅' : '❌';
      const dur = bank.duration ? `${(bank.duration / 1000).toFixed(1)}s` : 'N/A';
      console.log(`  ${icon} ${bank.bankName}: ${dur} (${bank.transactionsImported} txns, ${bank.transactionsSkipped} duplicates)`);
      if (bank.reconciliationStatus) this.printReconciliationLine(bank);
      if (bank.error) console.log(`     ❌ Error: ${bank.error}`);
    }
  }

  private printReconciliationLine(bank: BankMetrics): void {
    const reconIcon = bank.reconciliationStatus === 'created' ? '🔄' : '✅';
    const reconMessages: Record<string, string> = {
      created: bank.reconciliationAmount !== undefined ? `${bank.reconciliationAmount > 0 ? '+' : ''}${(bank.reconciliationAmount / 100).toFixed(2)} ILS` : '',
      skipped: 'balanced',
      'already-reconciled': 'already reconciled',
    };
    console.log(`     ${reconIcon} Reconciliation: ${reconMessages[bank.reconciliationStatus!]}`);
  }

  /**
   * Get metrics for a specific bank
   */
  getBankMetrics(bankName: string): BankMetrics | undefined {
    return this.banks.get(bankName);
  }

  /**
   * Check if any banks failed
   */
  hasFailures(): boolean {
    return Array.from(this.banks.values()).some(b => b.status === 'failure');
  }

  /**
   * Get error breakdown by type
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
}
