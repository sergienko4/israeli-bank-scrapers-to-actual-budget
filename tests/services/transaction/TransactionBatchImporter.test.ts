/**
 * Edge-case unit tests for TransactionBatchImporter — locks in the
 * dedup-aware batch loop, the "already exists" classification on
 * import error, and the category-resolver delegation that flows
 * payee_name / imported_payee / category from a successful resolve.
 *
 * Happy path is exercised by tests/services/TransactionService.test.ts;
 * this file covers only the importer-local branches.
 */
import type api from '@actual-app/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DedupQuery from '../../../src/Services/Transaction/DedupQuery.js';
import {
  buildImportedId, buildImportedIdLegacy, parseTransaction,
} from '../../../src/Services/Transaction/ImportedIdBuilder.js';
import TransactionBatchImporter from '../../../src/Services/Transaction/TransactionBatchImporter.js';
import type { ICategoryResolver } from '../../../src/Services/ICategoryResolver.js';
import type { IBankTransaction } from '../../../src/Types/Index.js';

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('../../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  getLogBuffer: vi.fn(),
  createLogger: vi.fn(),
}));

interface IMockApi {
  importTransactions: ReturnType<typeof vi.fn>;
  aqlQuery: ReturnType<typeof vi.fn>;
  q: ReturnType<typeof vi.fn>;
}

let mockApi: IMockApi;

function buildQ(): ReturnType<typeof vi.fn> {
  return vi.fn(() => ({ filter: vi.fn(() => ({ select: vi.fn() })) }));
}

beforeEach(() => {
  mockApi = {
    importTransactions: vi.fn().mockResolvedValue(undefined),
    aqlQuery: vi.fn().mockResolvedValue({ data: [] }),
    q: buildQ(),
  };
  vi.clearAllMocks();
});

function buildImporter(resolver?: ICategoryResolver): TransactionBatchImporter {
  const dq = new DedupQuery(mockApi as unknown as typeof api);
  return new TransactionBatchImporter(mockApi as unknown as typeof api, dq, resolver);
}

const sampleTxn: IBankTransaction = {
  date: '2026-02-14', chargedAmount: -100, description: 'Test', identifier: '9999',
};

describe('TransactionBatchImporter.processBatch — empty + classification', () => {
  it('returns empty arrays when given no transactions', async () => {
    const importer = buildImporter();
    const out = await importer.processBatch({
      bankName: 'discount', accountNumber: '123', actualAccountId: 'acc',
      transactions: [],
    });
    expect(out.newTransactions).toEqual([]);
    expect(out.existingTransactions).toEqual([]);
    expect(mockApi.importTransactions).not.toHaveBeenCalled();
  });

  it('classifies a duplicate "already exists" error as existing, not failure', async () => {
    mockApi.importTransactions.mockRejectedValueOnce(new Error('row already exists'));
    const importer = buildImporter();
    const out = await importer.processBatch({
      bankName: 'discount', accountNumber: '123', actualAccountId: 'acc',
      transactions: [sampleTxn],
    });
    expect(out.newTransactions).toEqual([]);
    expect(out.existingTransactions).toHaveLength(1);
  });

  it('logs other import errors and does not classify them as duplicates', async () => {
    mockApi.importTransactions.mockRejectedValueOnce(new Error('network down'));
    const importer = buildImporter();
    const out = await importer.processBatch({
      bankName: 'discount', accountNumber: '123', actualAccountId: 'acc',
      transactions: [sampleTxn],
    });
    expect(out.newTransactions).toEqual([]);
    expect(out.existingTransactions).toEqual([]);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error importing transaction: network down'),
    );
  });
});

describe('TransactionBatchImporter.processBatch — duplicate charges', () => {
  const charge: IBankTransaction = {
    date: '2026-02-14', chargedAmount: -18.9, description: 'Coffee Shop',
  };
  const batch = {
    bankName: 'discount', accountNumber: '123', actualAccountId: 'acc',
  };

  /**
   * Collects the imported_id of every transaction sent to Actual Budget.
   * @returns imported_id values in call order.
   */
  function importedIds(): string[] {
    return mockApi.importTransactions.mock.calls.map((call) => String(
      (call as [string, Array<Record<string, unknown>>])[1][0].imported_id,
    ));
  }

  it('gives both copies of a genuine double charge a distinct id', async () => {
    const out = await buildImporter().processBatch({
      ...batch, transactions: [charge, { ...charge }],
    });
    expect(out.newTransactions).toHaveLength(2);
    expect(new Set(importedIds()).size).toBe(2);
  });

  it('leaves a lone transaction hashing exactly as before', async () => {
    await buildImporter().processBatch({ ...batch, transactions: [charge] });
    expect(importedIds()).toEqual([
      buildImportedId('discount-123', charge, parseTransaction(charge)),
    ]);
  });

  it('re-scraping the same batch reuses the same ids and adds nothing new', async () => {
    await buildImporter().processBatch({ ...batch, transactions: [charge, { ...charge }] });
    const firstRun = importedIds();
    mockApi.importTransactions.mockClear();
    mockApi.aqlQuery.mockResolvedValue({
      data: firstRun.map((id) => ({ imported_id: id })),
    });

    const out = await buildImporter().processBatch({
      ...batch, transactions: [charge, { ...charge }],
    });

    expect(out.newTransactions).toEqual([]);
    expect(out.existingTransactions).toHaveLength(2);
    expect(new Set(importedIds())).toEqual(new Set(firstRun));
  });

  it('numbers identical charges by content, not by position in the batch', async () => {
    const other: IBankTransaction = {
      date: '2026-02-14', chargedAmount: -5, description: 'Bus',
    };
    await buildImporter().processBatch({
      ...batch, transactions: [charge, other, { ...charge }],
    });
    const ids = importedIds();
    expect(ids[0]).toBe(buildImportedId('discount-123', charge, parseTransaction(charge)));
    expect(ids[1]).toBe(buildImportedId('discount-123', other, parseTransaction(other)));
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('does not let one legacy row suppress the second copy of a duplicate', async () => {
    const legacyId = buildImportedIdLegacy('discount-123', charge, parseTransaction(charge));
    mockApi.aqlQuery.mockResolvedValue({ data: [{ imported_id: legacyId }] });

    const out = await buildImporter().processBatch({
      ...batch, transactions: [charge, { ...charge }],
    });

    expect(out.existingTransactions).toHaveLength(1);
    expect(out.newTransactions).toHaveLength(1);
  });

  it('matches BOTH legacy rows when identical charges carry distinct identifiers', async () => {
    // Credit-card scrapers (Isracard, Cal, Max) supply a unique identifier per
    // charge, so two identical charges already in a pre-2026-05 ledger hold two
    // DISTINCT legacy ids. Both must still be recognised, otherwise upgrading
    // re-imports the second one as a phantom duplicate.
    const copyA: IBankTransaction = { ...charge, identifier: 'txn-abc' };
    const copyB: IBankTransaction = { ...charge, identifier: 'txn-def' };
    mockApi.aqlQuery.mockResolvedValue({
      data: [
        { imported_id: buildImportedIdLegacy('discount-123', copyA, parseTransaction(copyA)) },
        { imported_id: buildImportedIdLegacy('discount-123', copyB, parseTransaction(copyB)) },
      ],
    });

    const out = await buildImporter().processBatch({
      ...batch, transactions: [copyA, copyB],
    });

    expect(out.existingTransactions).toHaveLength(2);
    expect(out.newTransactions).toEqual([]);
  });

  it('re-submits a legacy-only match under its legacy id, not a fresh hash', async () => {
    // The ledger row is stored under the legacy id. Submitting the newly
    // derived hash would hand Actual Budget an id it has never seen, so it
    // would insert a second row instead of matching the one just recognised.
    const historic: IBankTransaction = { ...charge, identifier: 'txn-abc' };
    const parsed = parseTransaction(historic);
    const legacyId = buildImportedIdLegacy('discount-123', historic, parsed);
    mockApi.aqlQuery.mockResolvedValue({ data: [{ imported_id: legacyId }] });

    const out = await buildImporter().processBatch({ ...batch, transactions: [historic] });

    expect(out.existingTransactions).toHaveLength(1);
    expect(importedIds()).toEqual([legacyId]);
    expect(importedIds()).not.toContain(buildImportedId('discount-123', historic, parsed));
  });
});

describe('TransactionBatchImporter.processBatch — category resolver delegation', () => {
  it('applies payeeName / importedPayee / categoryId when resolver returns success', async () => {
    const resolver: ICategoryResolver = {
      initialize: vi.fn().mockResolvedValue({ success: true, data: { status: 'ready' } }),
      resolve: vi.fn().mockReturnValue({
        success: true,
        data: { payeeName: 'P', importedPayee: 'IP', categoryId: 'CAT-1' },
      }),
    };
    const importer = buildImporter(resolver);
    await importer.processBatch({
      bankName: 'discount', accountNumber: '123', actualAccountId: 'acc',
      transactions: [sampleTxn],
    });
    const payload = (mockApi.importTransactions.mock.calls[0] as [string, Array<Record<string, unknown>>])[1][0];
    expect(payload.payee_name).toBe('P');
    expect(payload.imported_payee).toBe('IP');
    expect(payload.category).toBe('CAT-1');
  });

  it('falls back to txn description when resolver returns no success', async () => {
    const resolver: ICategoryResolver = {
      initialize: vi.fn().mockResolvedValue({ success: true, data: { status: 'ready' } }),
      resolve: vi.fn().mockReturnValue({ success: false }),
    };
    const importer = buildImporter(resolver);
    await importer.processBatch({
      bankName: 'discount', accountNumber: '123', actualAccountId: 'acc',
      transactions: [sampleTxn],
    });
    const payload = (mockApi.importTransactions.mock.calls[0] as [string, Array<Record<string, unknown>>])[1][0];
    expect(payload.payee_name).toBe('Test');
    expect(payload.imported_payee).toBe('Test');
    expect(payload.category).toBeUndefined();
  });
});
