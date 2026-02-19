import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReconciliationService } from '../../src/services/ReconciliationService.js';

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  let mockApi: any;

  beforeEach(() => {
    mockApi = {
      runQuery: vi.fn(),
      importTransactions: vi.fn(),
      q: vi.fn(() => ({
        filter: vi.fn(() => ({
          calculate: vi.fn()
        }))
      }))
    };
    service = new ReconciliationService(mockApi);
  });

  describe('reconcile', () => {
    it('skips when balance matches exactly', async () => {
      // Current balance in Actual: 10000 cents = 100.00
      mockApi.runQuery.mockResolvedValue({ data: 10000 });

      const result = await service.reconcile('account-123', 100.00, 'ILS');

      expect(result.status).toBe('skipped');
      expect(result.diff).toBe(0);
      expect(mockApi.importTransactions).not.toHaveBeenCalled();
    });

    it('creates reconciliation when balance differs', async () => {
      // Current balance in Actual: 10000 cents = 100.00
      // Expected balance: 150.00 = 15000 cents
      // Diff: 15000 - 10000 = 5000 cents
      mockApi.runQuery.mockResolvedValue({ data: 10000 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      const result = await service.reconcile('account-123', 150.00, 'ILS');

      expect(result.status).toBe('created');
      expect(result.diff).toBe(5000);
      expect(mockApi.importTransactions).toHaveBeenCalledTimes(1);
    });

    it('creates transaction with correct imported_id format', async () => {
      mockApi.runQuery.mockResolvedValue({ data: 10000 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      await service.reconcile('account-123', 150.00, 'ILS');

      const callArgs = mockApi.importTransactions.mock.calls[0];
      expect(callArgs[0]).toBe('account-123');

      const transaction = callArgs[1][0];
      expect(transaction.imported_id).toMatch(/^reconciliation-account-123-\d{4}-\d{2}-\d{2}$/);
      expect(transaction.payee_name).toBe('Reconciliation');
      expect(transaction.amount).toBe(5000);
      expect(transaction.cleared).toBe(true);
      expect(transaction.notes).toContain('Expected 150 ILS');
    });

    it('handles negative balance difference', async () => {
      // Current: 15000 cents = 150.00
      // Expected: 100.00 = 10000 cents
      // Diff: 10000 - 15000 = -5000
      mockApi.runQuery.mockResolvedValue({ data: 15000 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      const result = await service.reconcile('account-123', 100.00, 'ILS');

      expect(result.status).toBe('created');
      expect(result.diff).toBe(-5000);
    });

    it('returns already-reconciled when duplicate detected', async () => {
      mockApi.runQuery.mockResolvedValue({ data: 10000 });
      mockApi.importTransactions.mockRejectedValue(new Error('Transaction already exists'));

      const result = await service.reconcile('account-123', 150.00, 'ILS');

      expect(result.status).toBe('already-reconciled');
      expect(result.diff).toBe(0);
    });

    it('re-throws non-duplicate errors', async () => {
      mockApi.runQuery.mockResolvedValue({ data: 10000 });
      mockApi.importTransactions.mockRejectedValue(new Error('Database error'));

      await expect(service.reconcile('account-123', 150.00, 'ILS'))
        .rejects.toThrow('Database error');
    });

    it('handles zero actual balance', async () => {
      mockApi.runQuery.mockResolvedValue({ data: 0 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      const result = await service.reconcile('account-123', 50.00, 'ILS');

      expect(result.status).toBe('created');
      expect(result.diff).toBe(5000);
    });

    it('handles null data in query result', async () => {
      mockApi.runQuery.mockResolvedValue({ data: null });
      mockApi.importTransactions.mockResolvedValue(undefined);

      const result = await service.reconcile('account-123', 50.00, 'ILS');

      expect(result.status).toBe('created');
      expect(result.diff).toBe(5000);
    });

    it('uses default currency ILS', async () => {
      mockApi.runQuery.mockResolvedValue({ data: 10000 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      await service.reconcile('account-123', 150.00);

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.notes).toContain('ILS');
    });

    it('handles expected balance of zero', async () => {
      mockApi.runQuery.mockResolvedValue({ data: 10000 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      const result = await service.reconcile('account-123', 0, 'ILS');

      expect(result.status).toBe('created');
      expect(result.diff).toBe(-10000);
    });

    it('uses custom currency in notes', async () => {
      mockApi.runQuery.mockResolvedValue({ data: 10000 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      await service.reconcile('account-123', 150.00, 'USD');

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.notes).toContain('USD');
      expect(transaction.notes).toContain('Expected 150');
    });

    it('handles very large balance differences', async () => {
      mockApi.runQuery.mockResolvedValue({ data: 0 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      const result = await service.reconcile('account-123', 999999.99, 'ILS');

      expect(result.status).toBe('created');
      expect(result.diff).toBe(99999999);
    });

    it('creates transaction with correct date format', async () => {
      mockApi.runQuery.mockResolvedValue({ data: 10000 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      await service.reconcile('account-123', 150.00, 'ILS');

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
