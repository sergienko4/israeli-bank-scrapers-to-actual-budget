import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HistoryCategoryResolver } from '../../src/services/HistoryCategoryResolver.js';

describe('HistoryCategoryResolver', () => {
  let resolver: HistoryCategoryResolver;
  let mockApi: any;

  function buildMockApi(rows: Array<{ imported_payee: string; category: string; date: string }>) {
    return {
      runQuery: vi.fn().mockResolvedValue({ data: rows }),
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
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('initialize', () => {
    it('loads payee-category map from database', async () => {
      mockApi = buildMockApi([
        { imported_payee: 'Supermarket', category: 'cat-groceries', date: '2026-02-18' },
        { imported_payee: 'Gas Station', category: 'cat-transport', date: '2026-02-17' }
      ]);
      resolver = new HistoryCategoryResolver(mockApi);
      await resolver.initialize();

      expect(mockApi.q).toHaveBeenCalledWith('transactions');
      expect(resolver.resolve('Supermarket')).toEqual({ categoryId: 'cat-groceries' });
    });

    it('handles empty database', async () => {
      mockApi = buildMockApi([]);
      resolver = new HistoryCategoryResolver(mockApi);
      await resolver.initialize();

      expect(resolver.resolve('Anything')).toBeUndefined();
    });

    it('uses first occurrence for duplicate payees (most recent by date)', async () => {
      mockApi = buildMockApi([
        { imported_payee: 'Store', category: 'cat-new', date: '2026-02-18' },
        { imported_payee: 'Store', category: 'cat-old', date: '2026-01-01' }
      ]);
      resolver = new HistoryCategoryResolver(mockApi);
      await resolver.initialize();

      expect(resolver.resolve('Store')).toEqual({ categoryId: 'cat-new' });
    });

    it('skips rows with null imported_payee', async () => {
      mockApi = buildMockApi([
        { imported_payee: '', category: 'cat-1', date: '2026-02-18' },
        { imported_payee: 'Valid', category: 'cat-2', date: '2026-02-17' }
      ]);
      resolver = new HistoryCategoryResolver(mockApi);
      await resolver.initialize();

      expect(resolver.resolve('')).toBeUndefined();
      expect(resolver.resolve('Valid')).toEqual({ categoryId: 'cat-2' });
    });
  });

  describe('resolve', () => {
    beforeEach(async () => {
      mockApi = buildMockApi([
        { imported_payee: 'שופרסל דיזנגוף', category: 'cat-groceries', date: '2026-02-18' },
        { imported_payee: 'חברת חשמל', category: 'cat-utilities', date: '2026-02-17' },
        { imported_payee: 'Gas Station', category: 'cat-transport', date: '2026-02-16' }
      ]);
      resolver = new HistoryCategoryResolver(mockApi);
      await resolver.initialize();
    });

    it('matches exact payee (case-insensitive)', () => {
      expect(resolver.resolve('שופרסל דיזנגוף')).toEqual({ categoryId: 'cat-groceries' });
    });

    it('matches partial — description contains known payee', () => {
      expect(resolver.resolve('gas station branch 5')).toEqual({ categoryId: 'cat-transport' });
    });

    it('matches partial — known payee contains description', () => {
      expect(resolver.resolve('שופרסל')).toEqual({ categoryId: 'cat-groceries' });
    });

    it('returns undefined for unknown payee', () => {
      expect(resolver.resolve('Unknown Store')).toBeUndefined();
    });

    it('is case-insensitive for English payees', () => {
      expect(resolver.resolve('GAS STATION')).toEqual({ categoryId: 'cat-transport' });
    });

    it('returns undefined before initialize is called', () => {
      const uninitResolver = new HistoryCategoryResolver(buildMockApi([]));
      expect(uninitResolver.resolve('Anything')).toBeUndefined();
    });
  });
});
