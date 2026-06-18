/**
 * Unit tests for AccountReconciler — validates the reconciliation flow
 * guards and edge cases discovered in production (Paybox bugs).
 *
 * Tests cover:
 * 1. Balance undefined guard (existing behavior)
 * 2. Balance zero guard for API-direct banks (fix for paybox-reconcile-zero)
 * 3. Balance zero allowed for reliable banks (negative test)
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { AccountReconciler } from '../../../src/Services/Account/AccountReconciler.js';
import type { IReconcileCtx } from '../../../src/Services/Account/AccountReconciler.js';
import type { IBankTarget } from '../../../src/Types/Index.js';
import { succeed } from '../../../src/Types/Index.js';

describe('AccountReconciler', () => {
  let mockReconciliationService: {
    reconcile: Mock;
  };
  let mockMetrics: {
    recordReconciliation: Mock;
  };
  let reconciler: AccountReconciler;

  beforeEach(() => {
    mockReconciliationService = {
      reconcile: vi.fn().mockResolvedValue(succeed({ status: 'created', diff: 100 })),
    };
    mockMetrics = {
      recordReconciliation: vi.fn(),
    };
    reconciler = new AccountReconciler({
      reconciliationService: mockReconciliationService as never,
      metrics: mockMetrics as never,
    });
  });

  describe('reconcile flag guard', () => {
    it('skips reconciliation when reconcile=false', async () => {
      const target: IBankTarget = { reconcile: false } as IBankTarget;
      const ctx: IReconcileCtx = {
        actualAccountId: 'acc-123',
        balance: 100,
        currency: 'ILS',
        bankName: 'hapoalim',
      };

      await reconciler.reconcileIfConfigured(target, ctx);

      expect(mockReconciliationService.reconcile).not.toHaveBeenCalled();
    });
  });

  describe('balance undefined guard (existing)', () => {
    it('skips reconciliation when balance is undefined', async () => {
      const target: IBankTarget = { reconcile: true } as IBankTarget;
      const ctx: IReconcileCtx = {
        actualAccountId: 'acc-123',
        balance: undefined,
        currency: 'ILS',
        bankName: 'hapoalim',
      };

      await reconciler.reconcileIfConfigured(target, ctx);

      expect(mockReconciliationService.reconcile).not.toHaveBeenCalled();
    });
  });

  describe('balance zero guard for API-direct banks (fix for paybox-reconcile-zero)', () => {
    const apiDirectBanks = ['onezero', 'pepper', 'paybox', 'OneZero', 'Pepper', 'PayBox'];

    apiDirectBanks.forEach((bankName) => {
      it(`skips reconciliation when balance=0 for ${bankName}`, async () => {
        const target: IBankTarget = { reconcile: true } as IBankTarget;
        const ctx: IReconcileCtx = {
          actualAccountId: 'acc-123',
          balance: 0,
          currency: 'ILS',
          bankName,
        };

        await reconciler.reconcileIfConfigured(target, ctx);

        expect(mockReconciliationService.reconcile).not.toHaveBeenCalled();
      });
    });

    it('allows reconciliation when balance=0 for reliable banks (e.g., hapoalim)', async () => {
      const target: IBankTarget = { reconcile: true } as IBankTarget;
      const ctx: IReconcileCtx = {
        actualAccountId: 'acc-123',
        balance: 0,
        currency: 'ILS',
        bankName: 'hapoalim',
      };

      await reconciler.reconcileIfConfigured(target, ctx);

      expect(mockReconciliationService.reconcile).toHaveBeenCalledWith('acc-123', 0, 'ILS');
    });

    it('allows reconciliation when balance>0 for API-direct banks', async () => {
      const target: IBankTarget = { reconcile: true } as IBankTarget;
      const ctx: IReconcileCtx = {
        actualAccountId: 'acc-123',
        balance: 100,
        currency: 'ILS',
        bankName: 'payBox',
      };

      await reconciler.reconcileIfConfigured(target, ctx);

      expect(mockReconciliationService.reconcile).toHaveBeenCalledWith('acc-123', 100, 'ILS');
    });
  });

  describe('successful reconciliation flow', () => {
    it('calls reconciliation service and records metrics', async () => {
      const target: IBankTarget = { reconcile: true } as IBankTarget;
      const ctx: IReconcileCtx = {
        actualAccountId: 'acc-123',
        balance: 100,
        currency: 'ILS',
        bankName: 'hapoalim',
      };

      await reconciler.reconcileIfConfigured(target, ctx);

      expect(mockReconciliationService.reconcile).toHaveBeenCalledWith('acc-123', 100, 'ILS');
      expect(mockMetrics.recordReconciliation).toHaveBeenCalledWith('hapoalim', 'created', 100);
    });
  });
});
