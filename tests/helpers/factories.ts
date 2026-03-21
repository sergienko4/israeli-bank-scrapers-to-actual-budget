/**
 * Test factory functions using @faker-js/faker.
 * Use these wherever the specific value doesn't matter — only keep pinned
 * literals in tests that assert on exact strings (imported_id formats,
 * Hebrew payees, numeric formatting, etc.).
 */

import { faker } from '@faker-js/faker';
import type {
  IBankTransaction,
  IBankConfig,
  IBankTarget,
  IImporterConfig,
  ITelegramConfig,
  IActualAccount,
  ITransactionRecord,
  ISpendingWatchRule,
} from '../../src/Types/Index.js';
import type {
  IImportSummary,
  IBankMetrics,
  IAccountMetrics,
} from '../../src/Services/MetricsService.js';
import type { IAuditEntry } from '../../src/Services/AuditLogService.js';

export function fakeUuid(): string {
  return faker.string.uuid();
}

export function fakeBankTransaction(overrides?: Partial<IBankTransaction>): IBankTransaction {
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
  overrides?: Partial<IBankTransaction>,
): IBankTransaction[] {
  return Array.from({ length: count }, () => fakeBankTransaction(overrides));
}

export function fakeTransactionRecord(overrides?: Partial<ITransactionRecord>): ITransactionRecord {
  return {
    date: faker.date.recent({ days: 30 }).toISOString().split('T')[0],
    description: faker.company.name(),
    amount: faker.number.int({ min: -500000, max: 500000 }),
    ...overrides,
  };
}

export function fakeActualAccount(overrides?: Partial<IActualAccount>): IActualAccount {
  return {
    id: fakeUuid(),
    name: faker.company.name(),
    offbudget: false,
    closed: false,
    ...overrides,
  };
}

export function fakeBankTarget(overrides?: Partial<IBankTarget>): IBankTarget {
  return {
    actualAccountId: fakeUuid(),
    reconcile: false,
    accounts: 'all',
    ...overrides,
  };
}

export function fakeBankConfig(overrides?: Partial<IBankConfig>): IBankConfig {
  return {
    id: faker.string.numeric(9),
    password: faker.internet.password({ length: 12 }),
    num: faker.string.alphanumeric(6).toUpperCase(),
    daysBack: faker.number.int({ min: 7, max: 90 }),
    targets: [fakeBankTarget()],
    ...overrides,
  };
}

export function fakeImporterConfig(overrides?: Partial<IImporterConfig>): IImporterConfig {
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

export function fakeTelegramConfig(overrides?: Partial<ITelegramConfig>): ITelegramConfig {
  const botId = faker.number.int({ min: 100000000, max: 999999999 });
  const botSecret = faker.string.alphanumeric(35);
  return {
    botToken: `${botId}:${botSecret}`,
    chatId: `-${faker.number.int({ min: 100000000, max: 999999999 })}`,
    ...overrides,
  };
}

export function fakeAccountMetrics(overrides?: Partial<IAccountMetrics>): IAccountMetrics {
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

export function fakeBankMetrics(overrides?: Partial<IBankMetrics>): IBankMetrics {
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

export function fakeImportSummary(overrides?: Partial<IImportSummary>): IImportSummary {
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

export function fakeSpendingWatchRule(overrides?: Partial<ISpendingWatchRule>): ISpendingWatchRule {
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
 * @returns A merged IAuditEntry object.
 */
export function fakeIAuditEntry(overrides: Partial<IAuditEntry> = {}): IAuditEntry {
  return {
    timestamp: new Date().toISOString(),
    totalBanks: 1, successfulBanks: 0, failedBanks: 1,
    totalTransactions: 0, totalDuplicates: 0,
    totalDuration: 5000, successRate: 0,
    banks: [],
    ...overrides,
  };
}
