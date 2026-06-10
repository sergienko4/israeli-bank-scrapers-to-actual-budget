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
