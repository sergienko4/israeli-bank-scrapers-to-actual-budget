/**
 * Known test data for E2E tests.
 * All values are deterministic for predictable assertions.
 */

import { ImportSummary, BankMetrics, AccountMetrics } from '../../../src/services/MetricsService.js';

const TEST_BANK_NAME = 'e2eTestBank';
const TEST_ACCOUNT_NUMBER = 'E2E-001';

export function createTestSummary(overrides?: Partial<ImportSummary>): ImportSummary {
  const accounts: AccountMetrics[] = [{
    accountNumber: TEST_ACCOUNT_NUMBER,
    balance: 10050,
    currency: 'ILS',
    newTransactions: [
      { date: '2026-02-20', description: 'Test Supermarket', amount: -15050 },
      { date: '2026-02-20', description: 'Test Salary', amount: 500000 },
    ],
    existingTransactions: [
      { date: '2026-02-19', description: 'Test Netflix', amount: -4990 },
    ],
  }];

  const banks: BankMetrics[] = [{
    bankName: TEST_BANK_NAME,
    startTime: Date.now() - 8000,
    endTime: Date.now(),
    duration: 8000,
    status: 'success',
    transactionsImported: 2,
    transactionsSkipped: 1,
    accounts,
  }];

  return {
    totalBanks: 1,
    successfulBanks: 1,
    failedBanks: 0,
    totalTransactions: 2,
    totalDuplicates: 1,
    totalDuration: 8000,
    averageDuration: 8000,
    successRate: 100,
    banks,
    ...overrides,
  };
}
