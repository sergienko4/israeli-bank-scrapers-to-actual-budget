import { describe, it, expect, vi } from 'vitest';
import type api from '@actual-app/api';
import { SpendingWatchService } from '../../src/services/SpendingWatchService.js';
import { SpendingWatchRule } from '../../src/types/index.js';

function createMockApi(transactions: Array<{ date: string; imported_payee: string; amount: number }> = []) {
  return {
    runQuery: vi.fn().mockResolvedValue({ data: transactions }),
    q: vi.fn().mockReturnValue({
      filter: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({})
        })
      })
    }),
    init: vi.fn(),
    shutdown: vi.fn(),
    downloadBudget: vi.fn(),
    importTransactions: vi.fn(),
  } as unknown as typeof api;
}

const today = new Date().toISOString().split('T')[0];

describe('SpendingWatchService', () => {
  describe('evaluate', () => {
    it('returns null when no rules', async () => {
      const service = new SpendingWatchService([], createMockApi());
      expect(await service.evaluate()).toBeNull();
    });

    it('returns null when spending is below threshold', async () => {
      const rules: SpendingWatchRule[] = [
        { alertFromAmount: 1000, numOfDayToCount: 1 }
      ];
      const txns = [
        { date: today, imported_payee: 'Coffee Shop', amount: -500 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      expect(await service.evaluate()).toBeNull();
    });

    it('returns alert when spending exceeds threshold', async () => {
      const rules: SpendingWatchRule[] = [
        { alertFromAmount: 100, numOfDayToCount: 1 }
      ];
      const txns = [
        { date: today, imported_payee: 'Supermarket', amount: -15000 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result).toContain('Spending Watch');
      expect(result).toContain('All payees');
      expect(result).toContain('Supermarket');
    });

    it('filters by watchPayees when configured', async () => {
      const rules: SpendingWatchRule[] = [
        { alertFromAmount: 40, numOfDayToCount: 7, watchPayees: ['Netflix'] }
      ];
      const txns = [
        { date: today, imported_payee: 'Netflix Inc.', amount: -4990 },
        { date: today, imported_payee: 'Supermarket', amount: -50000 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result).toContain('Netflix');
      expect(result).not.toContain('Supermarket');
    });

    it('uses case-insensitive substring matching for payees', async () => {
      const rules: SpendingWatchRule[] = [
        { alertFromAmount: 10, numOfDayToCount: 1, watchPayees: ['netflix'] }
      ];
      const txns = [
        { date: today, imported_payee: 'NETFLIX Premium HD', amount: -4990 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result).toContain('NETFLIX Premium HD');
    });

    it('counts all payees when watchPayees is empty', async () => {
      const rules: SpendingWatchRule[] = [
        { alertFromAmount: 100, numOfDayToCount: 1, watchPayees: [] }
      ];
      const txns = [
        { date: today, imported_payee: 'Store A', amount: -8000 },
        { date: today, imported_payee: 'Store B', amount: -5000 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result).toContain('All payees');
      expect(result).toContain('130.00');
    });

    it('evaluates multiple rules independently', async () => {
      const rules: SpendingWatchRule[] = [
        { alertFromAmount: 50, numOfDayToCount: 1 },
        { alertFromAmount: 99999, numOfDayToCount: 30 }
      ];
      const txns = [
        { date: today, imported_payee: 'Shop', amount: -10000 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result).toContain('1 day');
      expect(result).not.toContain('30 days');
    });

    it('returns null when no transactions exist', async () => {
      const rules: SpendingWatchRule[] = [
        { alertFromAmount: 100, numOfDayToCount: 7 }
      ];
      const service = new SpendingWatchService(rules, createMockApi([]));
      expect(await service.evaluate()).toBeNull();
    });

    it('shows max 5 transactions per rule with overflow count', async () => {
      const rules: SpendingWatchRule[] = [
        { alertFromAmount: 1, numOfDayToCount: 1 }
      ];
      const txns = Array.from({ length: 8 }, (_, i) => ({
        date: today, imported_payee: `Store ${i + 1}`, amount: -1000
      }));
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result).toContain('Store 1');
      expect(result).toContain('Store 5');
      expect(result).toContain('3 more');
    });

    it('handles null imported_payee gracefully', async () => {
      const rules: SpendingWatchRule[] = [
        { alertFromAmount: 1, numOfDayToCount: 1, watchPayees: ['test'] }
      ];
      const txns = [
        { date: today, imported_payee: null as unknown as string, amount: -5000 },
        { date: today, imported_payee: '', amount: -3000 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      expect(await service.evaluate()).toBeNull();
    });

    it('handles API errors gracefully', async () => {
      const mockApi = createMockApi();
      (mockApi as unknown as { runQuery: ReturnType<typeof vi.fn> }).runQuery.mockRejectedValue(new Error('API down'));
      const rules: SpendingWatchRule[] = [
        { alertFromAmount: 100, numOfDayToCount: 1 }
      ];
      const service = new SpendingWatchService(rules, mockApi);
      expect(await service.evaluate()).toBeNull();
    });

    it('formats day label correctly for 1 day', async () => {
      const rules: SpendingWatchRule[] = [
        { alertFromAmount: 1, numOfDayToCount: 1 }
      ];
      const txns = [{ date: today, imported_payee: 'Test', amount: -1000 }];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result).toContain('1 day');
    });

    it('formats day label correctly for multiple days', async () => {
      const rules: SpendingWatchRule[] = [
        { alertFromAmount: 1, numOfDayToCount: 7 }
      ];
      const txns = [{ date: today, imported_payee: 'Test', amount: -1000 }];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result).toContain('7 days');
    });

    it('shows watchPayees names in alert header', async () => {
      const rules: SpendingWatchRule[] = [
        { alertFromAmount: 1, numOfDayToCount: 1, watchPayees: ['Netflix', 'Gym'] }
      ];
      const txns = [{ date: today, imported_payee: 'Netflix Inc', amount: -5000 }];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result).toContain('Netflix, Gym');
    });
  });
});
