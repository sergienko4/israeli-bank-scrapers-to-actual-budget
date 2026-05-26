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
  ICanonicalAccount,
  ICanonicalScrapeResult,
  IBankFilter,
  IBankResult,
  IBankQuarantineEntry,
  IBankQuarantineStage,
  IBankResultsState,
} from '../../src/Types/Index.js';
import type { IPipelineConfig } from '../../src/Scrapers/Pipeline/Index.js';
import type {
  IImportSummary,
  IBankMetrics,
  IAccountMetrics,
  IAccountTransactionsRecord,
} from '../../src/Services/MetricsService.js';
import type { IAuditEntry } from '../../src/Services/AuditLogService.js';
import type { IBatchResult } from '../../src/Types/Index.js';

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

export function fakeAccountTransactionsRecord(
  overrides?: Partial<IAccountTransactionsRecord>,
): IAccountTransactionsRecord {
  return {
    accountNumber: faker.string.numeric(10),
    balance: faker.number.int({ min: -100000, max: 1000000 }),
    currency: 'ILS',
    newTransactions: [],
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

// ── Phase-3 pipeline factories ──────────────────────────────────────────────

/** Permissive IBankFilter used by default in pipeline test contexts. */
export const ALLOW_ALL_BANK_FILTER: IBankFilter = Object.freeze({
  /**
   * Admits every bank regardless of name.
   * @returns Constant `true`.
   */
  matches: (): boolean => true,
});

/**
 * Builds a fake IPipelineConfig (IImporterConfig + bankFilter + delayBetweenBanks).
 * @param overrides - Pinned overrides applied last (e.g. banks, bankFilter).
 * @returns An IPipelineConfig suitable for ProcessAllBanksStep tests.
 */
export function fakePipelineConfig(
  overrides: Partial<IPipelineConfig> = {},
): IPipelineConfig {
  return {
    ...fakeImporterConfig(),
    bankFilter: ALLOW_ALL_BANK_FILTER,
    delayBetweenBanks: 0,
    ...overrides,
  } as IPipelineConfig;
}

/**
 * Builds a fake ICanonicalAccount with a single transaction by default.
 * @param overrides - Pinned overrides applied last.
 * @returns Canonical account fixture.
 */
export function fakeCanonicalAccount(
  overrides: Partial<ICanonicalAccount> = {},
): ICanonicalAccount {
  return {
    accountNumber: faker.string.numeric(10),
    balance: faker.number.int({ min: -100000, max: 1000000 }),
    txns: [fakeBankTransaction()],
    ...overrides,
  };
}

/**
 * Builds a fake ICanonicalScrapeResult with realistic metadata.
 * @param overrides - Pinned overrides applied last (commonly `accounts`).
 * @returns Canonical scrape result fixture.
 */
export function fakeCanonicalScrapeResult(
  overrides: Partial<ICanonicalScrapeResult> = {},
): ICanonicalScrapeResult {
  const today = new Date().toISOString().split('T')[0];
  return {
    bankId: faker.helpers.arrayElement(BANK_NAMES),
    scrapedAt: new Date().toISOString(),
    accounts: [],
    metadata: {
      startDate: today, endDate: today,
      signPolicyApplied: 'preserve', strategy: 'live', attemptCount: 1,
    },
    ...overrides,
  };
}

/**
 * Builds a fake IBankResult (successful bank entry).
 * @param overrides - Pinned overrides applied last.
 * @returns Successful per-bank outcome fixture.
 */
export function fakeBankResult(
  overrides: Partial<IBankResult> = {},
): IBankResult {
  return {
    bankName: faker.helpers.arrayElement(BANK_NAMES),
    imported: faker.number.int({ min: 0, max: 20 }),
    skipped: faker.number.int({ min: 0, max: 5 }),
    durationMs: faker.number.int({ min: 100, max: 5000 }),
    ...overrides,
  };
}

/**
 * Builds a fake IBankQuarantineEntry (failed bank entry with original Error).
 * @param overrides - Pinned overrides applied last (commonly `stage`/`bankName`/`error`).
 * @returns Quarantine entry fixture.
 */
export function fakeBankQuarantineEntry(
  overrides: Partial<IBankQuarantineEntry> = {},
): IBankQuarantineEntry {
  return {
    bankName: faker.helpers.arrayElement(BANK_NAMES),
    stage: 'scrape',
    error: new Error(faker.lorem.sentence(3)),
    durationMs: faker.number.int({ min: 50, max: 3000 }),
    ...overrides,
  };
}

/** Options bundle for {@link fakeBankResultsState}. */
export interface IFakeBankResultsStateOpts {
  readonly successfulCount?: number;
  readonly quarantinedCount?: number;
  readonly stage?: IBankQuarantineStage;
  readonly successful?: readonly IBankResult[];
  readonly quarantined?: readonly IBankQuarantineEntry[];
  readonly totalBanks?: number;
}

/**
 * Builds an indexed successful-results array (`ok-0`, `ok-1`, …) for stable assertions.
 * @param count - Number of entries to generate.
 * @returns Frozen-friendly array of indexed IBankResult fixtures.
 */
function buildIndexedSuccessful(count: number): readonly IBankResult[] {
  return Array.from({ length: count }, (_, i) => fakeBankResult({
    bankName: `ok-${String(i)}`, imported: 5, skipped: 0, durationMs: 200,
  }));
}

/**
 * Builds an indexed quarantined-results array (`bank-0`, `bank-1`, …).
 * @param count - Number of entries to generate.
 * @param stage - Stage label to apply to every entry.
 * @returns Frozen-friendly array of indexed IBankQuarantineEntry fixtures.
 */
function buildIndexedQuarantined(
  count: number, stage: IBankQuarantineStage,
): readonly IBankQuarantineEntry[] {
  return Array.from({ length: count }, (_, i) => fakeBankQuarantineEntry({
    bankName: `bank-${String(i)}`, stage,
    error: new Error(`error-${String(i)}`), durationMs: 100,
  }));
}

/**
 * Builds a fake IBankResultsState fixture with deterministic indexed bank names.
 *
 * Uses indexed names (`ok-0`, `bank-0`) so assertions on display order are stable.
 * @param opts - Counts + optional stage + optional explicit arrays.
 * @returns IBankResultsState fixture.
 */
export function fakeBankResultsState(
  opts: IFakeBankResultsStateOpts = {},
): IBankResultsState {
  const stage: IBankQuarantineStage = opts.stage ?? 'scrape';
  const successful = opts.successful
    ?? buildIndexedSuccessful(opts.successfulCount ?? 1);
  const quarantined = opts.quarantined
    ?? buildIndexedQuarantined(opts.quarantinedCount ?? 0, stage);
  return Object.freeze({
    successful, quarantined,
    totalBanks: opts.totalBanks ?? successful.length + quarantined.length,
  });
}

/**
 * Builds a fake IBatchResult fixture (defaults to a successful, empty batch).
 * Useful for Telegram router and ReplyBuilders tests.
 * @param overrides - Pinned overrides applied last (commonly failureCount/totalDurationMs).
 * @returns IBatchResult fixture.
 */
export function fakeBatchResult(
  overrides: Partial<IBatchResult> = {},
): IBatchResult {
  return {
    batchId: faker.string.uuid(),
    source: 'telegram',
    jobs: [],
    totalDurationMs: faker.number.int({ min: 1000, max: 60000 }),
    successCount: 1,
    failureCount: 0,
    ...overrides,
  };
}
