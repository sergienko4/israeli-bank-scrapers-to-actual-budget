import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransactionService } from '../../src/Services/TransactionService.js';
import { ICategoryResolver } from '../../src/Services/ICategoryResolver.js';
import { assertProcedureSuccess, fakeBankTransactions, fakeBankTransaction } from '../helpers/factories.js';

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
      assertProcedureSuccess(result);
      expect(result.data.imported).toBe(2);
      assertProcedureSuccess(result);
      expect(result.data.skipped).toBe(0);
      expect(mockApi.importTransactions).toHaveBeenCalledTimes(2);
    });

    it('generates 16-char hex imported_id from (account, date, amount, description)', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [{ date: '2026-02-14', chargedAmount: -100, description: 'Test', identifier: '9999' }];
      await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });

      const callArgs = mockApi.importTransactions.mock.calls[0];
      const transaction = callArgs[1][0];
      expect(transaction.imported_id).toMatch(/^[a-f0-9]{16}$/);
    });

    it('produces deterministic imported_id — same content → same hash', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns1 = [{ date: '2026-02-14', chargedAmount: -100, description: 'Test', identifier: 'a' }];
      await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns1 });
      const firstId = mockApi.importTransactions.mock.calls[0][1][0].imported_id;

      // Different identifier, same content
      mockApi.importTransactions.mockClear();
      const txns2 = [{ date: '2026-02-14', chargedAmount: -100, description: 'Test', identifier: 'b' }];
      await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns2 });
      const secondId = mockApi.importTransactions.mock.calls[0][1][0].imported_id;

      expect(secondId).toBe(firstId);
    });

    it('uses content-hash even when identifier is missing', async () => {
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [{ date: '2026-02-14', chargedAmount: -100.50, description: 'Test' }];
      await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });

      const transaction = mockApi.importTransactions.mock.calls[0][1][0];
      expect(transaction.imported_id).toMatch(/^[a-f0-9]{16}$/);
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
      assertProcedureSuccess(result);
      expect(result.data.imported).toBe(1);
      assertProcedureSuccess(result);
      expect(result.data.skipped).toBe(1);
    });

    it('logs non-duplicate errors without counting as skipped', async () => {
      mockApi.importTransactions.mockRejectedValue(new Error('Database error'));

      const txns = [fakeBankTransaction()];
      const result = await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });

      expect(result.success).toBe(true);
      assertProcedureSuccess(result);
      expect(result.data.imported).toBe(0);
      assertProcedureSuccess(result);
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
      assertProcedureSuccess(result);
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
      assertProcedureSuccess(result);
      expect(result.data.imported).toBe(0);
      assertProcedureSuccess(result);
      expect(result.data.skipped).toBe(1);
    });

    it('warns and treats as new when aqlQuery returns null data', async () => {
      mockApi.aqlQuery.mockResolvedValue(null);
      mockApi.importTransactions.mockResolvedValue(undefined);
      const txns = [{ date: '2026-02-14', chargedAmount: -50, description: 'Test', identifier: 'txn-1' }];
      const result = await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: txns });
      expect(result.success).toBe(true);
      assertProcedureSuccess(result);
      expect(result.data.imported).toBe(1);
    });

    it('filters null imported_ids from AQL result without crashing', async () => {
      mockApi.aqlQuery.mockResolvedValue({
        data: [
          { imported_id: 'discount-123456-real-1' },
          { imported_id: null },
          { imported_id: 'discount-123456-real-2' },
        ],
      });
      mockApi.importTransactions.mockResolvedValue(undefined);
      const txns = [
        { date: '2026-02-14', chargedAmount: -50, description: 'New', identifier: 'new-txn' },
      ];
      const result = await service.importTransactions({
        bankName: 'discount', accountNumber: '123456',
        actualAccountId: 'acc-id', transactions: txns,
      });
      expect(result.success).toBe(true);
      assertProcedureSuccess(result);
      expect(result.data.imported).toBe(1);
    });

    it('handles empty transactions array', async () => {
      const result = await service.importTransactions({ bankName: 'discount', accountNumber: '123456', actualAccountId: 'acc-id', transactions: [] });

      expect(result.success).toBe(true);
      assertProcedureSuccess(result);
      expect(result.data.imported).toBe(0);
      assertProcedureSuccess(result);
      expect(result.data.skipped).toBe(0);
      expect(mockApi.importTransactions).not.toHaveBeenCalled();
    });

    it('dedupes across runs when scraper returns unstable identifier (Bug #1)', async () => {
      // Simulates re-running the importer: same content, different identifier
      // each scrape. Old (identifier-based) formula would create a duplicate;
      // new (content-hash) formula must dedup.
      mockApi.importTransactions.mockResolvedValue(undefined);

      // First run: insert the txn, capture its imported_id
      const firstRun = [{
        date: '2026-05-19', chargedAmount: -28, description: 'Sandro Pizza',
        identifier: 'scrape-1-row-42',
      }];
      await service.importTransactions({
        bankName: 'visaCal', accountNumber: '3308',
        actualAccountId: 'acc-id', transactions: firstRun,
      });
      const insertedId = mockApi.importTransactions.mock.calls[0][1][0].imported_id;

      // Second run: same merchant, date, amount; scraper returns different identifier
      mockApi.importTransactions.mockClear();
      mockApi.aqlQuery.mockResolvedValue({ data: [{ imported_id: insertedId }] });

      const secondRun = [{
        date: '2026-05-19', chargedAmount: -28, description: 'Sandro Pizza',
        identifier: 'scrape-2-row-17',
      }];
      const result = await service.importTransactions({
        bankName: 'visaCal', accountNumber: '3308',
        actualAccountId: 'acc-id', transactions: secondRun,
      });

      expect(result.success).toBe(true);
      assertProcedureSuccess(result);
      expect(result.data.imported).toBe(0);
      assertProcedureSuccess(result);
      expect(result.data.skipped).toBe(1);
    });

    it('collision: same-day same-amount same-description → second txn is treated as duplicate (documented tradeoff)', async () => {
      // The new imported_id formula deliberately hashes only
      // (accountKey, date, amount, description) to remain robust against
      // upstream identifier drift. As a consequence, two genuinely
      // distinct transactions sharing exactly that tuple (e.g. two
      // identical coffee orders at the same merchant on the same day)
      // collapse to the same imported_id, and Actual Budget records
      // only the first one. This mirrors the upstream library's own
      // canonicalizeTxn at index.mjs:9572 — same tuple, same trade-off.
      // Including txn.identifier in the seed would re-introduce Bug 1
      // (unstable identifier causes re-imports to duplicate); including
      // txn.memo would break dedup whenever the scraper enriches memos
      // on some runs but not others.
      //
      // Simulate Actual Budget's "already exists" behaviour: first call
      // succeeds, second call rejects with the dup error message that
      // TransactionService.handleImportError matches on.
      mockApi.importTransactions
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Transaction already exists'));

      const sameDayPair = [
        { date: '2026-05-19', chargedAmount: -28, description: 'Aroma Espresso', identifier: 'a' },
        { date: '2026-05-19', chargedAmount: -28, description: 'Aroma Espresso', identifier: 'b' },
      ];
      const result = await service.importTransactions({
        bankName: 'visaCal', accountNumber: '3308',
        actualAccountId: 'acc-id', transactions: sameDayPair,
      });

      expect(result.success).toBe(true);
      assertProcedureSuccess(result);
      expect(result.data.imported).toBe(1);
      assertProcedureSuccess(result);
      expect(result.data.skipped).toBe(1);

      // Both insert attempts use the SAME imported_id (proves the collision)
      const firstCall = mockApi.importTransactions.mock.calls[0][1][0];
      const secondCall = mockApi.importTransactions.mock.calls[1][1][0];
      expect(secondCall.imported_id).toBe(firstCall.imported_id);
    });

    it('dual-check recognises legacy-format imported_id from existing data', async () => {
      // Migration safety: rows already in Actual Budget were inserted with
      // the OLD formula `${accountKey}-${identifier}`. After deploy, the
      // first scrape must still match those existing rows so we don't
      // create one final duplicate burst.
      mockApi.aqlQuery.mockResolvedValue({
        data: [{ imported_id: 'discount-123456-legacy-id-xyz' }],
      });
      mockApi.importTransactions.mockResolvedValue(undefined);

      const txns = [{
        date: '2026-02-14', chargedAmount: -100, description: 'Existing row',
        identifier: 'legacy-id-xyz',
      }];
      const result = await service.importTransactions({
        bankName: 'discount', accountNumber: '123456',
        actualAccountId: 'acc-id', transactions: txns,
      });

      expect(result.success).toBe(true);
      assertProcedureSuccess(result);
      expect(result.data.imported).toBe(0);
      assertProcedureSuccess(result);
      expect(result.data.skipped).toBe(1);
    });
  });

  describe('getOrCreateAccount', () => {
    it('returns existing account', async () => {
      const existingAccount = { id: 'acc-123', name: 'My Account' };
      mockApi.getAccounts.mockResolvedValue([existingAccount]);

      const result = await service.getOrCreateAccount('acc-123', 'discount', '999999');

      expect(result.success).toBe(true);
      assertProcedureSuccess(result);
      expect(result.data).toEqual(existingAccount);
      expect(mockApi.createAccount).not.toHaveBeenCalled();
    });

    it('creates account when not found', async () => {
      const newAccount = { id: 'acc-new', name: 'discount - 999999' };
      mockApi.getAccounts.mockResolvedValue([]);
      mockApi.createAccount.mockResolvedValue(newAccount);

      const result = await service.getOrCreateAccount('acc-new', 'discount', '999999');

      expect(result.success).toBe(true);
      assertProcedureSuccess(result);
      expect(result.data).toEqual(newAccount);
      expect(mockApi.createAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'discount - 999999',
          offbudget: false,
          closed: false
        })
      );
      expect(mockApi.createAccount).toHaveBeenCalledWith(
        expect.not.objectContaining({ id: expect.anything() })
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
      assertProcedureSuccess(result);
      expect(result.data).toEqual({ id: 'acc-222', name: 'Account 2' });
    });

    it('handles createAccount returning string ID (Actual API normal behavior)', async () => {
      mockApi.getAccounts.mockResolvedValue([]);
      mockApi.createAccount.mockResolvedValue('some-string-id');

      const result = await service.getOrCreateAccount('acc-new', 'discount', '999999');

      expect(result.success).toBe(true);
      if (result.success) {
        assertProcedureSuccess(result);
        expect(result.data.id).toBe('some-string-id');
        assertProcedureSuccess(result);
        expect(result.data.name).toBe('discount - 999999');
      }
    });

    it('returns failure when createAccount returns undefined', async () => {
      mockApi.getAccounts.mockResolvedValue([]);
      mockApi.createAccount.mockResolvedValue(undefined);

      const result = await service.getOrCreateAccount('acc-new', 'discount', '999999');

      expect(result.success).toBe(false);
      expect(result.status).toBe('account-not-found');
    });

    it('finds account by name when ID does not match (Actual ignores requested ID)', async () => {
      const actualAccount = { id: 'random-uuid-from-actual', name: 'discount - 999999' };
      mockApi.getAccounts.mockResolvedValue([actualAccount]);

      const result = await service.getOrCreateAccount('configured-id-ignored', 'discount', '999999');

      expect(result.success).toBe(true);
      assertProcedureSuccess(result);
      expect(result.data).toEqual(actualAccount);
      expect(mockApi.createAccount).not.toHaveBeenCalled();
    });

    it('logs name-based fallback when ID lookup fails but name matches', async () => {
      const actualAccount = { id: 'actual-uuid', name: 'discount - 999999' };
      mockApi.getAccounts.mockResolvedValue([actualAccount]);

      await service.getOrCreateAccount('wrong-id', 'discount', '999999');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Found existing account by name')
      );
    });

    it('warns when multiple accounts share the same name (old bug duplicates)', async () => {
      const accounts = [
        { id: 'uuid-1', name: 'discount - 999999' },
        { id: 'uuid-2', name: 'discount - 999999' },
        { id: 'uuid-3', name: 'discount - 999999' },
      ];
      mockApi.getAccounts.mockResolvedValue(accounts);

      const result = await service.getOrCreateAccount('no-match', 'discount', '999999');

      expect(result.success).toBe(true);
      assertProcedureSuccess(result);
      expect(result.data).toEqual(accounts[0]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('3 accounts named')
      );
      expect(mockApi.createAccount).not.toHaveBeenCalled();
    });

    it('prefers ID match over name match even with duplicates', async () => {
      const accounts = [
        { id: 'uuid-1', name: 'discount - 999999' },
        { id: 'exact-id', name: 'discount - 999999' },
        { id: 'uuid-3', name: 'discount - 999999' },
      ];
      mockApi.getAccounts.mockResolvedValue(accounts);

      const result = await service.getOrCreateAccount('exact-id', 'discount', '999999');

      expect(result.success).toBe(true);
      assertProcedureSuccess(result);
      expect(result.data.id).toBe('exact-id');
      expect(mockLogger.warn).not.toHaveBeenCalled();
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
      expect(txn.imported_payee).toBe('Unknown Store');
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
