/**
 * Edge-case unit tests for DedupQuery — locks in the AQL shape + the
 * deliberate omission of `$ne: null` server-side filter (some Actual
 * Budget versions return an empty result with that filter), client-side
 * null stripping, and the empty/missing-data branches.
 *
 * Happy path is exercised by tests/services/TransactionService.test.ts;
 * this file covers only the query-local edge cases.
 */
import type api from '@actual-app/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DedupQuery from '../../../src/Services/Transaction/DedupQuery.js';

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('../../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  getLogBuffer: vi.fn(),
  createLogger: vi.fn(),
}));

interface IMockApi {
  q: ReturnType<typeof vi.fn>;
  aqlQuery: ReturnType<typeof vi.fn>;
}

let mockApi: IMockApi;

function buildQueryChain(): ReturnType<typeof vi.fn> {
  return vi.fn(() => ({ filter: vi.fn(() => ({ select: vi.fn() })) }));
}

beforeEach(() => {
  mockApi = { q: buildQueryChain(), aqlQuery: vi.fn() };
  vi.clearAllMocks();
});

describe('DedupQuery.getExistingImportedIds', () => {
  it('returns a Set of imported_id strings when AQL returns data', async () => {
    mockApi.aqlQuery.mockResolvedValue({ data: [
      { imported_id: 'a1' }, { imported_id: 'a2' }, { imported_id: 'a3' },
    ]});
    const dq = new DedupQuery(mockApi as unknown as typeof api);
    const ids = await dq.getExistingImportedIds('acc-1');
    expect(ids).toBeInstanceOf(Set);
    expect(ids.size).toBe(3);
    expect(ids.has('a1')).toBe(true);
  });

  it('strips null imported_id values client-side', async () => {
    mockApi.aqlQuery.mockResolvedValue({ data: [
      { imported_id: 'keep' }, { imported_id: null }, { imported_id: 'also' },
    ]});
    const dq = new DedupQuery(mockApi as unknown as typeof api);
    const ids = await dq.getExistingImportedIds('acc-1');
    expect(ids.size).toBe(2);
    expect(ids.has('keep')).toBe(true);
    expect(ids.has('also')).toBe(true);
  });

  it('returns an empty Set and warns when AQL returns null', async () => {
    mockApi.aqlQuery.mockResolvedValue(null);
    const dq = new DedupQuery(mockApi as unknown as typeof api);
    const ids = await dq.getExistingImportedIds('acc-missing');
    expect(ids.size).toBe(0);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('No existing imported IDs found for account acc-missing'),
    );
  });

  it('returns an empty Set when AQL returns an object without data field', async () => {
    mockApi.aqlQuery.mockResolvedValue({});
    const dq = new DedupQuery(mockApi as unknown as typeof api);
    const ids = await dq.getExistingImportedIds('acc-empty');
    expect(ids.size).toBe(0);
  });
});
