import { describe, it, expect, beforeEach, vi } from 'vitest';
import type api from '@actual-app/api';
import HistoryCategoryResolver from '../../src/Services/HistoryCategoryResolver.js';
import { isSuccess, isFail } from '../../src/Types/Index.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
}));

interface IMockApi {
  aqlQuery: ReturnType<typeof vi.fn>;
  q: ReturnType<typeof vi.fn>;
}

/** Casts an IMockApi to the typeof api expected by the constructor. */
function asApi(mock: IMockApi): typeof api {
  return mock as unknown as typeof api;
}

describe('HistoryCategoryResolver', () => {
  let resolver: HistoryCategoryResolver;
  let mockApi: IMockApi;

  /**
   * Builds a mock Actual API with pre-loaded transaction rows.
   * @param rows - Array of payee/category/date objects returned by aqlQuery.
   * @returns An IMockApi stub with aqlQuery and q methods configured.
   */
  function buildMockApi(rows: Array<{ imported_payee: string; category: string; date: string }>): IMockApi {
    return {
      aqlQuery: vi.fn().mockResolvedValue({ data: rows }),
      q: vi.fn(() => ({
        filter: vi.fn(() => ({
          select: vi.fn(() => ({
            orderBy: vi.fn()
          }))
        }))
      }))
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('loads payee-category map from database', async () => {
      mockApi = buildMockApi([
        { imported_payee: 'Supermarket', category: 'cat-groceries', date: '2026-02-18' },
        { imported_payee: 'Gas Station', category: 'cat-transport', date: '2026-02-17' }
      ]);
      resolver = new HistoryCategoryResolver(asApi(mockApi));
      await resolver.initialize();

      expect(mockApi.q).toHaveBeenCalledWith('transactions');
      const result = resolver.resolve('Supermarket');
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ categoryId: 'cat-groceries' });
      }
    });

    it('handles empty database', async () => {
      mockApi = buildMockApi([]);
      resolver = new HistoryCategoryResolver(asApi(mockApi));
      await resolver.initialize();

      const result = resolver.resolve('Anything');
      expect(result.success).toBe(false);
    });

    it('uses first occurrence for duplicate payees (most recent by date)', async () => {
      mockApi = buildMockApi([
        { imported_payee: 'Store', category: 'cat-new', date: '2026-02-18' },
        { imported_payee: 'Store', category: 'cat-old', date: '2026-01-01' }
      ]);
      resolver = new HistoryCategoryResolver(asApi(mockApi));
      await resolver.initialize();

      const result = resolver.resolve('Store');
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ categoryId: 'cat-new' });
      }
    });

    it('logs non-Error object when initialize throws non-Error', async () => {
      mockApi = {
        ...buildMockApi([]),
        aqlQuery: vi.fn().mockRejectedValue('network down')
      };
      resolver = new HistoryCategoryResolver(asApi(mockApi));
      await resolver.initialize(); // should not throw
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('network down')
      );
    });

    it('skips rows with null imported_payee', async () => {
      mockApi = buildMockApi([
        { imported_payee: '', category: 'cat-1', date: '2026-02-18' },
        { imported_payee: 'Valid', category: 'cat-2', date: '2026-02-17' }
      ]);
      resolver = new HistoryCategoryResolver(asApi(mockApi));
      await resolver.initialize();

      const emptyResult = resolver.resolve('');
      expect(emptyResult.success).toBe(false);
      const validResult = resolver.resolve('Valid');
      expect(isSuccess(validResult)).toBe(true);
      if (isSuccess(validResult)) {
        expect(validResult.data).toEqual({ categoryId: 'cat-2' });
      }
    });
  });

  describe('resolve', () => {
    beforeEach(async () => {
      mockApi = buildMockApi([
        { imported_payee: 'שופרסל דיזנגוף', category: 'cat-groceries', date: '2026-02-18' },
        { imported_payee: 'חברת חשמל', category: 'cat-utilities', date: '2026-02-17' },
        { imported_payee: 'Gas Station', category: 'cat-transport', date: '2026-02-16' }
      ]);
      resolver = new HistoryCategoryResolver(asApi(mockApi));
      await resolver.initialize();
    });

    it('matches exact payee (case-insensitive)', () => {
      const result = resolver.resolve('שופרסל דיזנגוף');
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ categoryId: 'cat-groceries' });
      }
    });

    it('matches partial — description contains known payee', () => {
      const result = resolver.resolve('gas station branch 5');
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ categoryId: 'cat-transport' });
      }
    });

    it('matches partial — known payee contains description', () => {
      const result = resolver.resolve('שופרסל');
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ categoryId: 'cat-groceries' });
      }
    });

    it('returns undefined for unknown payee', () => {
      const result = resolver.resolve('Unknown Store');
      expect(result.success).toBe(false);
    });

    it('is case-insensitive for English payees', () => {
      const result = resolver.resolve('GAS STATION');
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ categoryId: 'cat-transport' });
      }
    });

    it('returns undefined before initialize is called', () => {
      const uninitResolver = new HistoryCategoryResolver(asApi(buildMockApi([])));
      const result = uninitResolver.resolve('Anything');
      expect(result.success).toBe(false);
    });
  });
});
