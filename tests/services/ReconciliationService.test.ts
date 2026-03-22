import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type api from '@actual-app/api';
import { ReconciliationService } from '../../src/Services/ReconciliationService.js';
import { isSuccess, isFail } from '../../src/Types/Index.js';

interface IMockApi {
  aqlQuery: Mock;
  importTransactions: Mock;
  q: Mock;
}

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  let mockApi: IMockApi;

  beforeEach(() => {
    mockApi = {
      aqlQuery: vi.fn(),
      importTransactions: vi.fn(),
      q: vi.fn(() => ({
        filter: vi.fn(() => ({
          calculate: vi.fn()
        }))
      }))
    };
    service = new ReconciliationService(mockApi as unknown as typeof api);
  });

  describe('reconcile', () => {
    it('skips when balance matches exactly', async () => {
      // Current balance in Actual: 10000 cents = 100
      mockApi.aqlQuery.mockResolvedValue({ data: 10000 });

      const result = await service.reconcile('account-123', 100, 'ILS');

      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.status).toBe('skipped');
      expect(result.data.diff).toBe(0);
      expect(mockApi.importTransactions).not.toHaveBeenCalled();
    });

    it('creates reconciliation when balance differs', async () => {
      // Current balance in Actual: 10000 cents = 100
      // Expected balance: 150 = 15000 cents
      // Diff: 15000 - 10000 = 5000 cents
      mockApi.aqlQuery.mockResolvedValue({ data: 10000 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      const result = await service.reconcile('account-123', 150, 'ILS');

      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.status).toBe('created');
      expect(result.data.diff).toBe(5000);
      expect(mockApi.importTransactions).toHaveBeenCalledTimes(1);
    });

    it('creates transaction with correct imported_id format', async () => {
      mockApi.aqlQuery.mockResolvedValue({ data: 10000 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      await service.reconcile('account-123', 150, 'ILS');

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
      // Current: 15000 cents = 150
      // Expected: 100 = 10000 cents
      // Diff: 10000 - 15000 = -5000
      mockApi.aqlQuery.mockResolvedValue({ data: 15000 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      const result = await service.reconcile('account-123', 100, 'ILS');

      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.status).toBe('created');
      expect(result.data.diff).toBe(-5000);
    });

    it('returns already-reconciled when duplicate detected', async () => {
      mockApi.aqlQuery.mockResolvedValue({ data: 10000 });
      mockApi.importTransactions.mockRejectedValue(new Error('Transaction already exists'));

      const result = await service.reconcile('account-123', 150, 'ILS');

      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.status).toBe('already-reconciled');
      expect(result.data.diff).toBe(0);
    });

    it('returns failure for non-duplicate errors', async () => {
      mockApi.aqlQuery.mockResolvedValue({ data: 10000 });
      mockApi.importTransactions.mockRejectedValue(new Error('Database error'));

      const result = await service.reconcile('account-123', 150, 'ILS');

      expect(result.success).toBe(false);
      if (!isFail(result)) return;
      expect(result.message).toContain('Database error');
    });

    it('handles zero actual balance', async () => {
      mockApi.aqlQuery.mockResolvedValue({ data: 0 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      const result = await service.reconcile('account-123', 50, 'ILS');

      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.status).toBe('created');
      expect(result.data.diff).toBe(5000);
    });

    it('handles null data in query result', async () => {
      mockApi.aqlQuery.mockResolvedValue({ data: null });
      mockApi.importTransactions.mockResolvedValue(undefined);

      const result = await service.reconcile('account-123', 50, 'ILS');

      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.status).toBe('created');
      expect(result.data.diff).toBe(5000);
    });

    it('uses default currency ILS', async () => {
      mockApi.aqlQuery.mockResolvedValue({ data: 10000 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      await service.reconcile('account-123', 150);

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.notes).toContain('ILS');
    });

    it('handles expected balance of zero', async () => {
      mockApi.aqlQuery.mockResolvedValue({ data: 10000 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      const result = await service.reconcile('account-123', 0, 'ILS');

      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.status).toBe('created');
      expect(result.data.diff).toBe(-10000);
    });

    it('uses custom currency in notes', async () => {
      mockApi.aqlQuery.mockResolvedValue({ data: 10000 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      await service.reconcile('account-123', 150, 'USD');

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.notes).toContain('USD');
      expect(transaction.notes).toContain('Expected 150');
    });

    it('handles very large balance differences', async () => {
      mockApi.aqlQuery.mockResolvedValue({ data: 0 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      const result = await service.reconcile('account-123', 999999.99, 'ILS');

      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.status).toBe('created');
      expect(result.data.diff).toBe(99999999);
    });

    it('creates transaction with correct date format', async () => {
      mockApi.aqlQuery.mockResolvedValue({ data: 10000 });
      mockApi.importTransactions.mockResolvedValue(undefined);

      await service.reconcile('account-123', 150, 'ILS');

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns failure for non-Error objects from importTransactions', async () => {
      mockApi.aqlQuery.mockResolvedValue({ data: 10000 });
      mockApi.importTransactions.mockRejectedValue('string error');

      const result = await service.reconcile('account-123', 150, 'ILS');

      expect(result.success).toBe(false);
      if (!isFail(result)) return;
      expect(result.message).toContain('string error');
    });
  });
});
