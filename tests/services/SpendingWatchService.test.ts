import { describe, it, expect, vi } from 'vitest';
import type api from '@actual-app/api';
import SpendingWatchService from '../../src/Services/SpendingWatchService.js';
import type { ISpendingWatchRule } from '../../src/Types/Index.js';
import { formatDate } from '../../src/Utils/Date.js';
import { fakeActualTransaction } from '../helpers/factories.js';

function createMockApi(transactions: Array<{ date: string; imported_payee: string; amount: number }> = []) {
  return {
    aqlQuery: vi.fn().mockResolvedValue({ data: transactions }),
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

const today = formatDate(new Date());

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  getLogBuffer: vi.fn(),
  createLogger: vi.fn(),
}));

describe('SpendingWatchService', () => {
  describe('evaluate', () => {
    it('returns success with noAlerts when no rules', async () => {
      const service = new SpendingWatchService([], createMockApi());
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ noAlerts: true });
    });

    it('returns success with noAlerts when spending is below threshold', async () => {
      const rules: ISpendingWatchRule[] = [
        { alertFromAmount: 1000, numOfDayToCount: 1 }
      ];
      const txns = [fakeActualTransaction({ date: today, amount: -500 })];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ noAlerts: true });
    });

    it('returns alert when spending exceeds threshold', async () => {
      const rules: ISpendingWatchRule[] = [
        { alertFromAmount: 100, numOfDayToCount: 1 }
      ];
      const txns = [
        { date: today, imported_payee: 'Supermarket', amount: -15000 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      expect('message' in result.data).toBe(true);
      const msg = (result.data as { message: string }).message;
      expect(msg).toContain('Spending Watch');
      expect(msg).toContain('All payees');
      expect(msg).toContain('Supermarket');
    });

    it('filters by watchPayees when configured', async () => {
      const rules: ISpendingWatchRule[] = [
        { alertFromAmount: 40, numOfDayToCount: 7, watchPayees: ['Netflix'] }
      ];
      const txns = [
        { date: today, imported_payee: 'Netflix Inc.', amount: -4990 },
        { date: today, imported_payee: 'Supermarket', amount: -50000 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      const msg = (result.data as { message: string }).message;
      expect(msg).toContain('Netflix');
      expect(msg).not.toContain('Supermarket');
    });

    it('uses case-insensitive substring matching for payees', async () => {
      const rules: ISpendingWatchRule[] = [
        { alertFromAmount: 10, numOfDayToCount: 1, watchPayees: ['netflix'] }
      ];
      const txns = [
        { date: today, imported_payee: 'NETFLIX Premium HD', amount: -4990 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      const msg = (result.data as { message: string }).message;
      expect(msg).toContain('NETFLIX Premium HD');
    });

    it('counts all payees when watchPayees is empty', async () => {
      const rules: ISpendingWatchRule[] = [
        { alertFromAmount: 100, numOfDayToCount: 1, watchPayees: [] }
      ];
      const txns = [
        { date: today, imported_payee: 'Store A', amount: -8000 },
        { date: today, imported_payee: 'Store B', amount: -5000 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      const msg = (result.data as { message: string }).message;
      expect(msg).toContain('All payees');
      expect(msg).toContain('130.00');
    });

    it('evaluates multiple rules independently', async () => {
      const rules: ISpendingWatchRule[] = [
        { alertFromAmount: 50, numOfDayToCount: 1 },
        { alertFromAmount: 99999, numOfDayToCount: 30 }
      ];
      const txns = [
        { date: today, imported_payee: 'Shop', amount: -10000 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      const msg = (result.data as { message: string }).message;
      expect(msg).toContain('1 day');
      expect(msg).not.toContain('30 days');
    });

    it('returns success with noAlerts when no transactions exist', async () => {
      const service = new SpendingWatchService(
        [{ alertFromAmount: 100, numOfDayToCount: 7 }],
        createMockApi([]),
      );
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ noAlerts: true });
    });

    it('shows max 5 transactions per rule with overflow count', async () => {
      const rules: ISpendingWatchRule[] = [
        { alertFromAmount: 1, numOfDayToCount: 1 }
      ];
      const txns = Array.from({ length: 8 }, (_, i) => ({
        date: today, imported_payee: `Store ${i + 1}`, amount: -1000
      }));
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      const msg = (result.data as { message: string }).message;
      expect(msg).toContain('Store 1');
      expect(msg).toContain('Store 5');
      expect(msg).toContain('3 more');
    });

    it('handles null imported_payee gracefully', async () => {
      const rules: ISpendingWatchRule[] = [
        { alertFromAmount: 1, numOfDayToCount: 1, watchPayees: ['test'] }
      ];
      const txns = [
        { date: today, imported_payee: null as unknown as string, amount: -5000 },
        { date: today, imported_payee: '', amount: -3000 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ noAlerts: true });
    });

    it('warns and returns no alerts when query returns null data', async () => {
      const mockApi = createMockApi();
      (mockApi as unknown as { aqlQuery: ReturnType<typeof vi.fn> }).aqlQuery.mockResolvedValue(null);
      const rules: ISpendingWatchRule[] = [
        { alertFromAmount: 9999, numOfDayToCount: 7 }
      ];
      const service = new SpendingWatchService(rules, mockApi);
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ noAlerts: true });
    });

    it('returns failure when API throws an error', async () => {
      const mockApi = createMockApi();
      (mockApi as unknown as { aqlQuery: ReturnType<typeof vi.fn> }).aqlQuery.mockRejectedValue(new Error('API down'));
      const rules: ISpendingWatchRule[] = [
        { alertFromAmount: 100, numOfDayToCount: 1 }
      ];
      const service = new SpendingWatchService(rules, mockApi);
      const result = await service.evaluate();
      expect(result.success).toBe(false);
      expect(result.message).toContain('API down');
    });

    it('formats day label correctly for 1 day', async () => {
      const txns = [fakeActualTransaction({ date: today, amount: -1000 })];
      const service = new SpendingWatchService(
        [{ alertFromAmount: 1, numOfDayToCount: 1 }],
        createMockApi(txns),
      );
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      const msg = (result.data as { message: string }).message;
      expect(msg).toContain('1 day');
    });

    it('formats day label correctly for multiple days', async () => {
      const txns = [fakeActualTransaction({ date: today, amount: -1000 })];
      const service = new SpendingWatchService(
        [{ alertFromAmount: 1, numOfDayToCount: 7 }],
        createMockApi(txns),
      );
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      const msg = (result.data as { message: string }).message;
      expect(msg).toContain('7 days');
    });

    it('shows watchPayees names in alert header', async () => {
      const rules: ISpendingWatchRule[] = [
        { alertFromAmount: 1, numOfDayToCount: 1, watchPayees: ['Netflix', 'Gym'] }
      ];
      const txns = [{ date: today, imported_payee: 'Netflix Inc', amount: -5000 }];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      const msg = (result.data as { message: string }).message;
      expect(msg).toContain('Netflix, Gym');
    });

    it('does not trigger when payee matches but amount below threshold', async () => {
      const rules: ISpendingWatchRule[] = [
        { alertFromAmount: 50000, numOfDayToCount: 14, watchPayees: ['מגדל'] }
      ];
      const txns = [
        { date: today, imported_payee: 'מגדל חברה חיוב', amount: -200000 },
        { date: today, imported_payee: 'חיוב מ-מגדל חברה לביטו', amount: -200000 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ noAlerts: true });
    });

    it('triggers when payee matches and amount exceeds threshold', async () => {
      const rules: ISpendingWatchRule[] = [
        { alertFromAmount: 10, numOfDayToCount: 14, watchPayees: ['מגדל'] }
      ];
      const txns = [
        { date: today, imported_payee: 'מגדל חברה חיוב', amount: -200000 },
        { date: today, imported_payee: 'חיוב מ-מגדל חברה לביטו', amount: -200000 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      const msg = (result.data as { message: string }).message;
      expect(msg).toContain('מגדל');
      expect(msg).toContain('4,000.00');
    });

    it('does not trigger when payee filter has no matches in data', async () => {
      const rules: ISpendingWatchRule[] = [
        { alertFromAmount: 1, numOfDayToCount: 30, watchPayees: ['NONEXISTENT'] }
      ];
      const txns = [
        { date: today, imported_payee: 'ישראכרט חיוב', amount: -500000 },
        { date: today, imported_payee: 'כ.א.ל חיוב', amount: -300000 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ noAlerts: true });
    });

    it('filters transactions by date window correctly', async () => {
      const oldDate = '2020-01-01';
      const rules: ISpendingWatchRule[] = [
        { alertFromAmount: 1, numOfDayToCount: 7 }
      ];
      const txns = [
        { date: today, imported_payee: 'Recent', amount: -1000 },
        { date: oldDate, imported_payee: 'Old', amount: -9999900 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      const msg = (result.data as { message: string }).message;
      expect(msg).toContain('Recent');
      expect(msg).not.toContain('Old');
    });

    it('shows Unknown for null payee in triggered alert details', async () => {
      const rules: ISpendingWatchRule[] = [
        { alertFromAmount: 1, numOfDayToCount: 1 }
      ];
      const txns = [
        { date: today, imported_payee: null as unknown as string, amount: -5000 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      const msg = (result.data as { message: string }).message;
      expect(msg).toContain('Unknown');
    });

    it('combines multiple triggered rules in one message', async () => {
      const rules: ISpendingWatchRule[] = [
        { alertFromAmount: 1, numOfDayToCount: 1 },
        { alertFromAmount: 1, numOfDayToCount: 7, watchPayees: ['Netflix'] },
        { alertFromAmount: 999999, numOfDayToCount: 30 }
      ];
      const txns = [
        { date: today, imported_payee: 'Netflix Inc', amount: -5000 },
        { date: today, imported_payee: 'Store', amount: -3000 }
      ];
      const service = new SpendingWatchService(rules, createMockApi(txns));
      const result = await service.evaluate();
      expect(result.success).toBe(true);
      const msg = (result.data as { message: string }).message;
      expect(msg).toContain('All payees');
      expect(msg).toContain('Netflix');
      expect(msg).not.toContain('30 days');
    });
  });
});
