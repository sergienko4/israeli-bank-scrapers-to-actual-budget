import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransactionService } from '../../src/Services/TransactionService.js';
import { ICategoryResolver } from '../../src/Services/ICategoryResolver.js';
import { fakeBankTransactions, fakeBankTransaction } from '../helpers/factories.js';

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  getLogBuffer: vi.fn(),
  createLogger: vi.fn(),
}));

describe('TransactionService', () => {
  let service: TransactionService;
  let mockApi: any;

  beforeEach(() => {
    mockApi = {
      importTransactions: vi.fn().mockResolvedValue(undefined),
      getAccounts: vi.fn(),
      createAccount: vi.fn(),
      aqlQuery: vi.fn().mockResolvedValue({ data: [] }),
      q: vi.fn(() => ({
        filter: vi.fn(() => ({
          select: vi.fn()
        }))
      }))
    };
    vi.clearAllMocks();
    service = new TransactionService(mockApi);
  });

  describe('importTransactions', () => {
    it('imports transactions and returns counts', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = fakeBankTransactions(2);
      const result = await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });

      expect(result.success).toBe(true);
      expect(result.data.imported).toBe(2);
      expect(result.data.skipped).toBe(0);
      expect(mockApi.importTransactions).toHaveBeenCalledTimes(2);
    });

    it('generates correct imported_id with identifier', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [{ date: '2026-02-14', chargedAmount: -100, description: 'Test', identifier: '9999' }];
      await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });

      const callArgs = mockApi.importTransactions.mock.calls[0];
      const transaction = callArgs[1][0];
      expect(transaction.imported_id).toBe('discount-123456-9999');
    });

    it('generates imported_id from date+amount when no identifier', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [{ date: '2026-02-14', chargedAmount: -100.50, description: 'Test' }];
      await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.imported_id).toBe('discount-123456-2026-02-14--100.5');
    });

    it('uses chargedAmount over originalAmount', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [fakeBankTransaction({ chargedAmount: -100, originalAmount: -200 })];
      await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.amount).toBe(-10000);
    });

    it('falls back to originalAmount when no chargedAmount', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [{ date: '2026-02-14', originalAmount: -75.50, description: 'Test', identifier: '1' }];
      await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.amount).toBe(-7550);
    });

    it('counts duplicates as skipped', async () => {
      mockApi.importTransactions
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Transaction already exists'));

      const txns = fakeBankTransactions(2);
      const result = await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });

      expect(result.success).toBe(true);
      expect(result.data.imported).toBe(1);
      expect(result.data.skipped).toBe(1);
    });

    it('logs non-duplicate errors without counting as skipped', async () => {
      mockApi.importTransactions.mockRejectedValue(new Error('Database error'));

      const txns = [fakeBankTransaction()];
      const result = await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });

      expect(result.success).toBe(true);
      expect(result.data.imported).toBe(0);
      expect(result.data.skipped).toBe(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error importing transaction: Database error')
      );
    });

    it('uses "Unknown" as payee when no description', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [{ date: '2026-02-14', chargedAmount: -100, identifier: '1' }];
      await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.payee_name).toBe('Unknown');
    });

    it('uses memo for notes when available', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [fakeBankTransaction({ memo: 'Reference: 123' })];
      await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.notes).toBe('Reference: 123');
    });

    it('sets cleared to true on all transactions', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [fakeBankTransaction()];
      await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.cleared).toBe(true);
    });

    it('uses 0 amount when both chargedAmount and originalAmount are undefined', async () => {
      const txns = [{ date: '2026-02-14', description: 'Cash', identifier: '1' }];
      await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });
      const txn = mockApi.importTransactions.mock.calls[0][1][0];
      expect(txn.amount).toBe(0);
    });

    it('handles non-Error thrown during import and logs it', async () => {
      mockApi.importTransactions.mockRejectedValue('network failure');
      const txns = [fakeBankTransaction()];
      const result = await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });
      expect(result.success).toBe(true);
      expect(result.data.imported).toBe(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('network failure')
      );
    });

    it('routes to existingTransactions when importedId already present in Actual', async () => {
      mockApi.aqlQuery.mockResolvedValue({ data: [{ imported_id: 'discount-123456-preexist' }] });
      mockApi.importTransactions.mockResolvedValue(undefined);
      const txns = [{ date: '2026-02-14', chargedAmount: -100, description: 'Update', identifier: 'preexist' }];
      const result = await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });
      expect(result.success).toBe(true);
      expect(result.data.imported).toBe(0);
      expect(result.data.skipped).toBe(1);
    });

    it('handles empty transactions array', async () => {
      const result = await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: [] });

      expect(result.success).toBe(true);
      expect(result.data.imported).toBe(0);
      expect(result.data.skipped).toBe(0);
      expect(mockApi.importTransactions).not.toHaveBeenCalled();
    });
  });

  describe('getOrCreateAccount', () => {
    it('returns existing account', async () => {
      const existingAccount = { id: 'acc-123', name: 'My Account' };
      mockApi.getAccounts.mockResolvedValue([existingAccount]);

      const result = await service.getOrCreateAccount('acc-123', 'discount', '999999');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(existingAccount);
      expect(mockApi.createAccount).not.toHaveBeenCalled();
    });

    it('creates account when not found', async () => {
      const newAccount = { id: 'acc-new', name: 'discount - 999999' };
      mockApi.getAccounts.mockResolvedValue([]);
      mockApi.createAccount.mockResolvedValue(newAccount);

      const result = await service.getOrCreateAccount('acc-new', 'discount', '999999');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(newAccount);
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

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 'acc-222', name: 'Account 2' });
    });

    it('returns failure when createAccount returns a string', async () => {
      mockApi.getAccounts.mockResolvedValue([]);
      mockApi.createAccount.mockResolvedValue('some-string-id');

      const result = await service.getOrCreateAccount('acc-new', 'discount', '999999');

      expect(result.success).toBe(false);
      expect(result.message).toBe('account not found');
    });

    it('returns failure when createAccount returns undefined', async () => {
      mockApi.getAccounts.mockResolvedValue([]);
      mockApi.createAccount.mockResolvedValue(undefined);

      const result = await service.getOrCreateAccount('acc-new', 'discount', '999999');

      expect(result.success).toBe(false);
      expect(result.status).toBe('account-not-found');
    });
  });

  describe('with category resolver', () => {
    let mockResolver: ICategoryResolver;

    beforeEach(() => {
      mockResolver = {
        initialize: vi.fn().mockResolvedValue(undefined),
        resolve: vi.fn()
      };
    });

    it('sets category from history resolver', async () => {
      (mockResolver.resolve as any).mockReturnValue({ success: true, data: { categoryId: 'cat-groceries' } });
      const svc = new TransactionService(mockApi, mockResolver);
      const txns = [{ date: '2026-02-14', chargedAmount: -100, description: 'Shufersal', identifier: '1' }];
      await svc.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });

      const txn = mockApi.importTransactions.mock.calls[0][1][0];
      expect(txn.category).toBe('cat-groceries');
      expect(txn.payee_name).toBe('Shufersal');
    });

    it('sets payee_name and imported_payee from translate resolver', async () => {
      (mockResolver.resolve as any).mockReturnValue({ success: true, data: { payeeName: 'Supermarket', importedPayee: 'סופר כל הטעמים' } });
      const svc = new TransactionService(mockApi, mockResolver);
      const txns = [{ date: '2026-02-14', chargedAmount: -50, description: 'סופר כל הטעמים', identifier: '1' }];
      await svc.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });

      const txn = mockApi.importTransactions.mock.calls[0][1][0];
      expect(txn.payee_name).toBe('Supermarket');
      expect(txn.imported_payee).toBe('סופר כל הטעמים');
    });

    it('falls back to description when resolver returns undefined', async () => {
      (mockResolver.resolve as any).mockReturnValue({ success: false, message: 'no match' });
      const svc = new TransactionService(mockApi, mockResolver);
      const txns = [{ date: '2026-02-14', chargedAmount: -100, description: 'Unknown Store', identifier: '1' }];
      await svc.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });

      const txn = mockApi.importTransactions.mock.calls[0][1][0];
      expect(txn.payee_name).toBe('Unknown Store');
      expect(txn.category).toBeUndefined();
      expect(txn.imported_payee).toBeUndefined();
    });

    it('works without resolver (undefined)', async () => {
      const svc = new TransactionService(mockApi);
      const txns = [{ date: '2026-02-14', chargedAmount: -100, description: 'Store', identifier: '1' }];
      await svc.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });

      const txn = mockApi.importTransactions.mock.calls[0][1][0];
      expect(txn.payee_name).toBe('Store');
      expect(txn.category).toBeUndefined();
    });
  });
});
