import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransactionService } from '../../src/services/TransactionService.js';

describe('TransactionService', () => {
  let service: TransactionService;
  let mockApi: any;

  beforeEach(() => {
    mockApi = {
      importTransactions: vi.fn().mockResolvedValue(undefined),
      getAccounts: vi.fn(),
      createAccount: vi.fn(),
      runQuery: vi.fn().mockResolvedValue({ data: [] }),
      q: vi.fn(() => ({
        filter: vi.fn(() => ({
          select: vi.fn()
        }))
      }))
    };
    service = new TransactionService(mockApi);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('importTransactions', () => {
    it('imports transactions and returns counts', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [
        { date: '2026-02-14', chargedAmount: -100.50, description: 'Store A', identifier: '1001' },
        { date: '2026-02-15', chargedAmount: -50.00, description: 'Store B', identifier: '1002' }
      ];

      const result = await service.importTransactions('discount', '123456', 'acc-id', txns);

      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
      expect(mockApi.importTransactions).toHaveBeenCalledTimes(2);
    });

    it('generates correct imported_id with identifier', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [{ date: '2026-02-14', chargedAmount: -100, description: 'Test', identifier: '9999' }];
      await service.importTransactions('discount', '123456', 'acc-id', txns);

      const callArgs = mockApi.importTransactions.mock.calls[0];
      const transaction = callArgs[1][0];
      expect(transaction.imported_id).toBe('discount-123456-9999');
    });

    it('generates imported_id from date+amount when no identifier', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [{ date: '2026-02-14', chargedAmount: -100.50, description: 'Test' }];
      await service.importTransactions('discount', '123456', 'acc-id', txns);

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.imported_id).toBe('discount-123456-2026-02-14--100.5');
    });

    it('uses chargedAmount over originalAmount', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [{ date: '2026-02-14', chargedAmount: -100, originalAmount: -200, description: 'Test', identifier: '1' }];
      await service.importTransactions('discount', '123456', 'acc-id', txns);

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.amount).toBe(-10000);
    });

    it('falls back to originalAmount when no chargedAmount', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [{ date: '2026-02-14', originalAmount: -75.50, description: 'Test', identifier: '1' }];
      await service.importTransactions('discount', '123456', 'acc-id', txns);

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.amount).toBe(-7550);
    });

    it('counts duplicates as skipped', async () => {
      mockApi.importTransactions
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Transaction already exists'));

      const txns = [
        { date: '2026-02-14', chargedAmount: -100, description: 'New', identifier: '1' },
        { date: '2026-02-14', chargedAmount: -200, description: 'Dup', identifier: '2' }
      ];

      const result = await service.importTransactions('discount', '123456', 'acc-id', txns);

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('logs non-duplicate errors without counting as skipped', async () => {
      mockApi.importTransactions.mockRejectedValue(new Error('Database error'));

      const txns = [{ date: '2026-02-14', chargedAmount: -100, description: 'Test', identifier: '1' }];
      const result = await service.importTransactions('discount', '123456', 'acc-id', txns);

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error importing transaction'),
        'Database error'
      );
    });

    it('uses "Unknown" as payee when no description', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [{ date: '2026-02-14', chargedAmount: -100, identifier: '1' }];
      await service.importTransactions('discount', '123456', 'acc-id', txns);

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.payee_name).toBe('Unknown');
    });

    it('uses memo for notes when available', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [{ date: '2026-02-14', chargedAmount: -100, description: 'Store', memo: 'Reference: 123', identifier: '1' }];
      await service.importTransactions('discount', '123456', 'acc-id', txns);

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.notes).toBe('Reference: 123');
    });

    it('sets cleared to true on all transactions', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [{ date: '2026-02-14', chargedAmount: -100, description: 'Test', identifier: '1' }];
      await service.importTransactions('discount', '123456', 'acc-id', txns);

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.cleared).toBe(true);
    });

    it('handles empty transactions array', async () => {
      const result = await service.importTransactions('discount', '123456', 'acc-id', []);

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
      expect(mockApi.importTransactions).not.toHaveBeenCalled();
    });
  });

  describe('getOrCreateAccount', () => {
    it('returns existing account', async () => {
      const existingAccount = { id: 'acc-123', name: 'My Account' };
      mockApi.getAccounts.mockResolvedValue([existingAccount]);

      const result = await service.getOrCreateAccount('acc-123', 'discount', '999999');

      expect(result).toEqual(existingAccount);
      expect(mockApi.createAccount).not.toHaveBeenCalled();
    });

    it('creates account when not found', async () => {
      const newAccount = { id: 'acc-new', name: 'discount - 999999' };
      mockApi.getAccounts.mockResolvedValue([]);
      mockApi.createAccount.mockResolvedValue(newAccount);

      const result = await service.getOrCreateAccount('acc-new', 'discount', '999999');

      expect(result).toEqual(newAccount);
      expect(mockApi.createAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'acc-new',
          name: 'discount - 999999',
          offbudget: false,
          closed: false
        })
      );
    });

    it('searches by exact account id', async () => {
      const accounts = [
        { id: 'acc-111', name: 'Account 1' },
        { id: 'acc-222', name: 'Account 2' }
      ];
      mockApi.getAccounts.mockResolvedValue(accounts);

      const result = await service.getOrCreateAccount('acc-222', 'leumi', '888888');

      expect(result).toEqual({ id: 'acc-222', name: 'Account 2' });
    });
  });
});
