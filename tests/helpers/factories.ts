/**
 * Test factory functions using @faker-js/faker.
 * Use these wherever the specific value doesn't matter — only keep pinned
 * literals in tests that assert on exact strings (imported_id formats,
 * Hebrew payees, numeric formatting, etc.).
 */

import { faker } from '@faker-js/faker';
import type { IProcedureSuccess, Procedure } from '../../src/Types/Index.js';
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
import { CREDENTIAL_SPECS, type ICredentialSpec } from '../../src/Config/ConfigLoaderValidator.js';
import { DEFAULT_BANK_REGISTRY } from '../../src/Scraper/BankRegistry.js';

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
    daysBack: faker.number.int({ min: 7, max: 30 }),
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
 * Builds a fake IBatchResult fixture (defaults to an empty, zero-count batch).
 * Useful for Telegram router and ReplyBuilders tests.
 * @param overrides - Pinned overrides applied last (commonly successCount/failureCount/jobs/totalDurationMs).
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
    successCount: 0,
    failureCount: 0,
    ...overrides,
  };
}

/**
 * Asserts that a Procedure result is successful, narrowing the type.
 * Throws with the failure message if the result is a failure.
 * @param result - The Procedure result to assert.
 */
export function assertProcedureSuccess<T>(
  result: Procedure<T>,
): asserts result is IProcedureSuccess<T> {
  if (!result.success) throw new Error(`Expected procedure success but got failure: ${result.message}`);
}

// ── Cross-bank parameterization helpers ────────────────────────────────────
// These drive `it.each` tests so every bank is exercised through the same
// validation flow instead of copy-pasted per-bank cases.

/** Ordered list of bank ids that have explicit credential specs. */
export const SPEC_BANK_IDS: readonly string[] = Object.freeze(Object.keys(CREDENTIAL_SPECS));

/** Every canonical bank id in the default registry (19 entries today). */
export const ALL_REGISTRY_BANK_IDS: readonly string[] = Object.freeze(
  DEFAULT_BANK_REGISTRY.list().map(entry => entry.bankId),
);

/** Per-spec values for parameterized credential tests. */
export interface IBankSpecCase {
  readonly bankId: string;
  readonly spec: ICredentialSpec;
}

/** Iterable of [bankId, spec] pairs for `describe.each`/`it.each`. */
export const BANK_SPEC_CASES: readonly IBankSpecCase[] = Object.freeze(
  Object.entries(CREDENTIAL_SPECS).map(([bankId, spec]) => Object.freeze({ bankId, spec })),
);

/** Flat list of [bankId, missingField] pairs covering every required field of every spec. */
export const BANK_MISSING_FIELD_CASES: readonly { bankId: string; field: keyof IBankConfig }[] = Object.freeze(
  BANK_SPEC_CASES.flatMap(({ bankId, spec }) =>
    spec.required.map(field => Object.freeze({ bankId, field })),
  ),
);

/** Realistic credential value per IBankConfig field, used by the spec-driven factory. */
const FIELD_VALUE_BUILDERS: Readonly<Record<string, () => string>> = Object.freeze({
  id: () => faker.string.numeric(9),
  password: () => faker.internet.password({ length: 12 }),
  num: () => faker.string.alphanumeric(6).toUpperCase(),
  username: () => faker.internet.username(),
  userCode: () => faker.string.alphanumeric(8),
  nationalID: () => faker.string.numeric(9),
  email: () => faker.internet.email(),
  phoneNumber: () => `972${faker.string.numeric(9)}`,
  card6Digits: () => faker.string.numeric(6),
});

/**
 * Builds the required-field payload for a bank by drawing realistic values
 * from {@link FIELD_VALUE_BUILDERS} for each field in the bank's spec.
 * @param bankId - Lowercased bank id present in CREDENTIAL_SPECS.
 * @returns Object containing exactly the fields the spec marks as required.
 */
function buildRequiredFieldsFor(bankId: string): Partial<IBankConfig> {
  const spec = CREDENTIAL_SPECS[bankId];
  if (!spec) throw new Error(`No credential spec for bankId: ${bankId}`);
  const payload: Record<string, string> = {};
  for (const field of spec.required) {
    const builder = FIELD_VALUE_BUILDERS[field];
    if (!builder) throw new Error(`No field-value builder for field: ${String(field)}`);
    payload[field] = builder();
  }
  return payload as Partial<IBankConfig>;
}

/**
 * Builds a valid IBankConfig for any bank with a credential spec, populating
 * every required field with realistic faker data and a default daysBack/targets.
 * @param bankId - Lowercased bank id (must exist in CREDENTIAL_SPECS).
 * @param overrides - Pinned overrides applied last (e.g. force a specific phoneNumber).
 * @returns IBankConfig containing all required credentials + sane defaults.
 */
export function fakeValidBankConfigFor(
  bankId: string, overrides: Partial<IBankConfig> = {},
): IBankConfig {
  return {
    ...buildRequiredFieldsFor(bankId),
    daysBack: 7,
    targets: [fakeBankTarget()],
    ...overrides,
  } as IBankConfig;
}

/**
 * Builds an IBankConfig for the bank with every required field populated EXCEPT
 * the named field, which is set to `undefined`. Used for negative-path tests.
 * @param bankId - Lowercased bank id (must exist in CREDENTIAL_SPECS).
 * @param field - Required field to omit (must appear in the bank's spec.required).
 * @returns IBankConfig with the named field removed; other required fields valid.
 */
export function fakeBankConfigMissingField(
  bankId: string, field: keyof IBankConfig,
): IBankConfig {
  const valid = fakeValidBankConfigFor(bankId);
  const { [field]: _omitted, ...rest } = valid as Record<string, unknown>;
  return rest as IBankConfig;
}
