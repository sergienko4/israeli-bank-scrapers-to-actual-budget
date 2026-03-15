/**
 * Test factory functions using @faker-js/faker.
 * Use these wherever the specific value doesn't matter — only keep pinned
 * literals in tests that assert on exact strings (imported_id formats,
 * Hebrew payees, numeric formatting, etc.).
 */

import { faker } from '@faker-js/faker';
import type {
  BankTransaction,
  BankConfig,
  BankTarget,
  ImporterConfig,
  TelegramConfig,
  ActualAccount,
  TransactionRecord,
  SpendingWatchRule,
} from '../../src/Types/Index.js';
import type {
  ImportSummary,
  BankMetrics,
  AccountMetrics,
} from '../../src/Services/MetricsService.js';
import type { AuditEntry } from '../../src/Services/AuditLogService.js';

export function fakeUuid(): string {
  return faker.string.uuid();
}

export function fakeBankTransaction(overrides?: Partial<BankTransaction>): BankTransaction {
  const amount = faker.number.float({ min: 1, max: 5000, fractionDigits: 2 });
  return {
    date: faker.date.recent({ days: 30 }).toISOString().split('T')[0],
    chargedAmount: faker.datatype.boolean() ? -amount : amount,
    description: faker.company.name(),
    identifier: faker.string.alphanumeric(8),
    ...overrides,
  };
}

export function fakeBankTransactions(
  count: number,
  overrides?: Partial<BankTransaction>,
): BankTransaction[] {
  return Array.from({ length: count }, () => fakeBankTransaction(overrides));
}

export function fakeTransactionRecord(overrides?: Partial<TransactionRecord>): TransactionRecord {
  return {
    date: faker.date.recent({ days: 30 }).toISOString().split('T')[0],
    description: faker.company.name(),
    amount: faker.number.int({ min: -500000, max: 500000 }),
    ...overrides,
  };
}

export function fakeActualAccount(overrides?: Partial<ActualAccount>): ActualAccount {
  return {
    id: fakeUuid(),
    name: faker.company.name(),
    offbudget: false,
    closed: false,
    ...overrides,
  };
}

export function fakeBankTarget(overrides?: Partial<BankTarget>): BankTarget {
  return {
    actualAccountId: fakeUuid(),
    reconcile: false,
    accounts: 'all',
    ...overrides,
  };
}

export function fakeBankConfig(overrides?: Partial<BankConfig>): BankConfig {
  return {
    id: faker.string.numeric(9),
    password: faker.internet.password({ length: 12 }),
    num: faker.string.alphanumeric(6).toUpperCase(),
    daysBack: faker.number.int({ min: 7, max: 90 }),
    targets: [fakeBankTarget()],
    ...overrides,
  };
}

export function fakeImporterConfig(overrides?: Partial<ImporterConfig>): ImporterConfig {
  return {
    actual: {
      init: {
        dataDir: './data',
        password: faker.internet.password({ length: 12 }),
        serverURL: 'http://localhost:5006',
      },
      budget: {
        syncId: fakeUuid(),
        password: null,
      },
    },
    banks: { discount: fakeBankConfig() },
    ...overrides,
  };
}

export function fakeTelegramConfig(overrides?: Partial<TelegramConfig>): TelegramConfig {
  const botId = faker.number.int({ min: 100000000, max: 999999999 });
  const botSecret = faker.string.alphanumeric(35);
  return {
    botToken: `${botId}:${botSecret}`,
    chatId: `-${faker.number.int({ min: 100000000, max: 999999999 })}`,
    ...overrides,
  };
}

export function fakeAccountMetrics(overrides?: Partial<AccountMetrics>): AccountMetrics {
  return {
    accountNumber: faker.string.numeric(10),
    balance: faker.number.int({ min: -100000, max: 1000000 }),
    currency: 'ILS',
    newTransactions: [fakeTransactionRecord()],
    existingTransactions: [],
    ...overrides,
  };
}

const BANK_NAMES = ['discount', 'leumi', 'hapoalim', 'mizrahi', 'beinleumi', 'yahav'] as const;

export function fakeBankMetrics(overrides?: Partial<BankMetrics>): BankMetrics {
  const startTime = Date.now() - faker.number.int({ min: 1000, max: 30000 });
  return {
    bankName: faker.helpers.arrayElement(BANK_NAMES),
    startTime,
    endTime: startTime + 5000,
    duration: 5000,
    status: 'success',
    transactionsImported: faker.number.int({ min: 0, max: 20 }),
    transactionsSkipped: faker.number.int({ min: 0, max: 5 }),
    accounts: [fakeAccountMetrics()],
    ...overrides,
  };
}

export function fakeImportSummary(overrides?: Partial<ImportSummary>): ImportSummary {
  const bank = fakeBankMetrics();
  return {
    totalBanks: 1,
    successfulBanks: 1,
    failedBanks: 0,
    totalTransactions: bank.transactionsImported,
    totalDuplicates: bank.transactionsSkipped,
    totalDuration: faker.number.int({ min: 1000, max: 30000 }),
    averageDuration: faker.number.int({ min: 1000, max: 10000 }),
    successRate: 100,
    banks: [bank],
    ...overrides,
  };
}

type ActualTransactionRow = { date: string; imported_payee: string; amount: number };

export function fakeActualTransaction(
  overrides?: Partial<ActualTransactionRow>,
): ActualTransactionRow {
  return {
    date: faker.date.recent({ days: 7 }).toISOString().split('T')[0],
    imported_payee: faker.company.name(),
    amount: -faker.number.int({ min: 100, max: 100000 }),
    ...overrides,
  };
}

export function fakeSpendingWatchRule(overrides?: Partial<SpendingWatchRule>): SpendingWatchRule {
  return {
    alertFromAmount: faker.number.int({ min: 10, max: 10000 }),
    numOfDayToCount: faker.number.int({ min: 1, max: 30 }),
    ...overrides,
  };
}

/**
 * Creates a fake audit-log entry with sensible defaults.
 * Generates a fresh timestamp per call to avoid time-sensitive flakiness.
 * @param overrides - Fields to override on the default entry.
 * @returns A merged AuditEntry object.
 */
export function fakeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    totalBanks: 1, successfulBanks: 0, failedBanks: 1,
    totalTransactions: 0, totalDuplicates: 0,
    totalDuration: 5000, successRate: 0,
    banks: [],
    ...overrides,
  };
}
