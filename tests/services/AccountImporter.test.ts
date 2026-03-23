import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AccountImporter } from '../../src/Services/AccountImporter.js';
import { DryRunCollector } from '../../src/Services/DryRunCollector.js';
import { succeed, fail } from '../../src/Types/Index.js';
import {
  fakeBankConfig, fakeBankTransactions, fakeBankTarget, fakeUuid,
} from '../helpers/factories.js';

// ── Logger mock ──────────────────────────────────────────────────────────────
const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  getLogBuffer: vi.fn(),
}));

// ── BankScraper (filterTransactionsByDate) mock ──────────────────────────────
vi.mock('../../src/Scraper/BankScraper.js', () => ({
  filterTransactionsByDate: vi.fn((txns: unknown[]) => txns),
  computeStartDate: vi.fn(() => new Date()),
  isEmptyResultError: vi.fn(),
  logScrapeFailure: vi.fn(),
  BankScraper: vi.fn(),
}));

// ─── helpers ─────────────────────────────────────────────────────────────────

const ACCOUNT_ID = fakeUuid();

function makeMockTransactionService() {
  return {
    importTransactions: vi.fn().mockResolvedValue(succeed({
      imported: 2, skipped: 0,
      newTransactions: [{ date: '2026-01-01', description: 'x', amount: -100 }],
      existingTransactions: [],
    })),
    getOrCreateAccount: vi.fn().mockResolvedValue(succeed({ id: ACCOUNT_ID, name: 'Test' })),
  };
}

function makeMockReconciliationService() {
  return { reconcile: vi.fn().mockResolvedValue(succeed({ status: 'skipped', diff: 0 })) };
}

function makeMockMetrics() {
  return {
    recordAccountTransactions: vi.fn(),
    recordReconciliation: vi.fn(),
  };
}

function makeDryRunCollector() {
  return new DryRunCollector();
}

function makeOpts(overrides = {}) {
  return {
    transactionService: makeMockTransactionService(),
    reconciliationService: makeMockReconciliationService(),
    metrics: makeMockMetrics(),
    isDryRun: false,
    dryRunCollector: makeDryRunCollector(),
    shutdownHandler: { isShuttingDown: vi.fn().mockReturnValue(false), onShutdown: vi.fn() },
    ...overrides,
  };
}

function makeScrapeResult(accounts: unknown[] = []) {
  return { success: true, accounts } as never;
}

// ─── processAllAccounts ───────────────────────────────────────────────────────

describe('AccountImporter.processAllAccounts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns zero counts when no accounts', async () => {
    const importer = new AccountImporter(makeOpts());
    const result = await importer.processAllAccounts('discount', fakeBankConfig(), makeScrapeResult([]));
    expect(result).toEqual({ imported: 0, skipped: 0 });
  });

  it('skips account with no matching target (no targets configured)', async () => {
    const opts = makeOpts();
    const importer = new AccountImporter(opts);
    const config = fakeBankConfig({ targets: [] });
    const account = {
      accountNumber: '999999', txns: fakeBankTransactions(1), balance: 500,
    };

    const result = await importer.processAllAccounts('discount', config, makeScrapeResult([account]));

    expect(result).toEqual({ imported: 0, skipped: 0 });
    expect(opts.transactionService.importTransactions).not.toHaveBeenCalled();
  });

  it('collects dry-run preview instead of importing', async () => {
    const opts = makeOpts({ isDryRun: true });
    const dryRunSpy = vi.spyOn(opts.dryRunCollector, 'recordAccount');
    const importer = new AccountImporter(opts);
    const config = fakeBankConfig({
      targets: [fakeBankTarget({ actualAccountId: ACCOUNT_ID, accounts: 'all' })],
    });
    const account = { accountNumber: '123456', txns: fakeBankTransactions(2), balance: 1000 };

    const result = await importer.processAllAccounts('discount', config, makeScrapeResult([account]));

    expect(result).toEqual({ imported: 0, skipped: 0 });
    expect(opts.transactionService.importTransactions).not.toHaveBeenCalled();
    expect(dryRunSpy).toHaveBeenCalled();
  });

  it('imports transactions and records metrics in normal mode', async () => {
    const opts = makeOpts();
    const importer = new AccountImporter(opts);
    const target = fakeBankTarget({ actualAccountId: ACCOUNT_ID, accounts: 'all', reconcile: false });
    const config = fakeBankConfig({ targets: [target] });
    const account = { accountNumber: '123456', txns: fakeBankTransactions(2), balance: undefined };

    const result = await importer.processAllAccounts('discount', config, makeScrapeResult([account]));

    expect(opts.transactionService.importTransactions).toHaveBeenCalled();
    expect(opts.metrics.recordAccountTransactions).toHaveBeenCalled();
    expect(result.imported).toBeGreaterThanOrEqual(0);
  });

  it('reconciles when reconcile=true and balance is provided', async () => {
    const opts = makeOpts();
    const importer = new AccountImporter(opts);
    const target = fakeBankTarget({ actualAccountId: ACCOUNT_ID, accounts: 'all', reconcile: true });
    const config = fakeBankConfig({ targets: [target] });
    const account = { accountNumber: '123456', txns: fakeBankTransactions(1), balance: 500 };

    await importer.processAllAccounts('discount', config, makeScrapeResult([account]));

    expect(opts.reconciliationService.reconcile).toHaveBeenCalledWith(ACCOUNT_ID, 500, 'ILS');
  });

  it('skips reconciliation when reconcile=false', async () => {
    const opts = makeOpts();
    const importer = new AccountImporter(opts);
    const target = fakeBankTarget({ actualAccountId: ACCOUNT_ID, accounts: 'all', reconcile: false });
    const config = fakeBankConfig({ targets: [target] });
    const account = { accountNumber: '123456', txns: fakeBankTransactions(1), balance: 500 };

    await importer.processAllAccounts('discount', config, makeScrapeResult([account]));

    expect(opts.reconciliationService.reconcile).not.toHaveBeenCalled();
  });

  it('skips reconciliation when balance is undefined', async () => {
    const opts = makeOpts();
    const importer = new AccountImporter(opts);
    const target = fakeBankTarget({ actualAccountId: ACCOUNT_ID, accounts: 'all', reconcile: true });
    const config = fakeBankConfig({ targets: [target] });
    const account = { accountNumber: '123456', txns: fakeBankTransactions(1), balance: undefined };

    await importer.processAllAccounts('discount', config, makeScrapeResult([account]));

    expect(opts.reconciliationService.reconcile).not.toHaveBeenCalled();
  });

  it('aborts mid-loop when shutdown is requested', async () => {
    const shutdownHandler = { isShuttingDown: vi.fn(), onShutdown: vi.fn() };
    shutdownHandler.isShuttingDown
      .mockReturnValueOnce(false)
      .mockReturnValue(true);

    const opts = makeOpts({ shutdownHandler });
    const importer = new AccountImporter(opts);
    const target = fakeBankTarget({ actualAccountId: ACCOUNT_ID, accounts: 'all' });
    const config = fakeBankConfig({ targets: [target] });
    const accounts = [
      { accountNumber: '1', txns: fakeBankTransactions(1), balance: undefined },
      { accountNumber: '2', txns: fakeBankTransactions(1), balance: undefined },
      { accountNumber: '3', txns: fakeBankTransactions(1), balance: undefined },
    ];

    await importer.processAllAccounts('discount', config, makeScrapeResult(accounts));

    // Only first account should be processed (shutdown triggers after first iteration check)
    expect(opts.transactionService.importTransactions).toHaveBeenCalledTimes(1);
  });

  it('handles reconciliation error gracefully without throwing', async () => {
    const opts = makeOpts();
    const reconcileError = new Error('reconcile failed');
    opts.reconciliationService.reconcile.mockResolvedValue(
      fail('Reconciliation failed: reconcile failed', { error: reconcileError })
    );
    const importer = new AccountImporter(opts);
    const target = fakeBankTarget({ actualAccountId: ACCOUNT_ID, accounts: 'all', reconcile: true });
    const config = fakeBankConfig({ targets: [target] });
    const account = { accountNumber: '123456', txns: fakeBankTransactions(1), balance: 500 };

    await expect(
      importer.processAllAccounts('discount', config, makeScrapeResult([account]))
    ).resolves.toBeDefined();
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Reconciliation error'));
  });

  it('matches target by specific account number', async () => {
    const opts = makeOpts();
    const importer = new AccountImporter(opts);
    const target = fakeBankTarget({
      actualAccountId: ACCOUNT_ID,
      accounts: ['123456'],
      reconcile: false,
    });
    const config = fakeBankConfig({ targets: [target] });
    const matched = { accountNumber: '123456', txns: fakeBankTransactions(1), balance: undefined };
    const unmatched = { accountNumber: '999999', txns: fakeBankTransactions(1), balance: undefined };

    await importer.processAllAccounts('discount', config, makeScrapeResult([matched, unmatched]));

    // Only one account should trigger import (the matched one)
    expect(opts.transactionService.importTransactions).toHaveBeenCalledTimes(1);
  });

  it('logs account info with account name when target has accountName', async () => {
    const opts = makeOpts();
    const importer = new AccountImporter(opts);
    const target = fakeBankTarget({
      actualAccountId: ACCOUNT_ID, accounts: 'all',
      reconcile: false, accountName: 'Main Account',
    });
    const config = fakeBankConfig({ targets: [target] });
    const account = { accountNumber: '123456', txns: fakeBankTransactions(1), balance: undefined };

    await importer.processAllAccounts('discount', config, makeScrapeResult([account]));

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Main Account'));
  });

  it('logs reconciliation created message with positive diff', async () => {
    const opts = makeOpts();
    opts.reconciliationService.reconcile.mockResolvedValue(
      succeed({ status: 'created', diff: 500 })
    );
    const importer = new AccountImporter(opts);
    const target = fakeBankTarget({ actualAccountId: ACCOUNT_ID, accounts: 'all', reconcile: true });
    const config = fakeBankConfig({ targets: [target] });
    const account = { accountNumber: '123456', txns: fakeBankTransactions(1), balance: 1000 };

    await importer.processAllAccounts('discount', config, makeScrapeResult([account]));

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('+5.00 ILS'));
  });

  it('logs already-reconciled message', async () => {
    const opts = makeOpts();
    opts.reconciliationService.reconcile.mockResolvedValue(
      succeed({ status: 'already-reconciled', diff: 0 })
    );
    const importer = new AccountImporter(opts);
    const target = fakeBankTarget({ actualAccountId: ACCOUNT_ID, accounts: 'all', reconcile: true });
    const config = fakeBankConfig({ targets: [target] });
    const account = { accountNumber: '123456', txns: fakeBankTransactions(1), balance: 1000 };

    await importer.processAllAccounts('discount', config, makeScrapeResult([account]));

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Already reconciled today'));
  });

  it('returns zero counts when getOrCreateAccount fails', async () => {
    const opts = makeOpts();
    opts.transactionService.getOrCreateAccount.mockResolvedValue(
      fail('Account not found')
    );
    const importer = new AccountImporter(opts);
    const target = fakeBankTarget({ actualAccountId: ACCOUNT_ID, accounts: 'all', reconcile: false });
    const config = fakeBankConfig({ targets: [target] });
    const account = { accountNumber: '123456', txns: fakeBankTransactions(1), balance: undefined };

    const result = await importer.processAllAccounts('discount', config, makeScrapeResult([account]));

    expect(result).toEqual({ imported: 0, skipped: 0 });
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Account error'));
    expect(opts.transactionService.importTransactions).not.toHaveBeenCalled();
  });

  it('returns zero counts when importTransactions fails', async () => {
    const opts = makeOpts();
    opts.transactionService.importTransactions.mockResolvedValue(
      fail('Import explosion')
    );
    const importer = new AccountImporter(opts);
    const target = fakeBankTarget({ actualAccountId: ACCOUNT_ID, accounts: 'all', reconcile: false });
    const config = fakeBankConfig({ targets: [target] });
    const account = { accountNumber: '123456', txns: fakeBankTransactions(1), balance: undefined };

    const result = await importer.processAllAccounts('discount', config, makeScrapeResult([account]));

    expect(result).toEqual({ imported: 0, skipped: 0 });
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Import error'));
  });

  it('logs reconciliation created message with negative diff (no + prefix)', async () => {
    const opts = makeOpts();
    opts.reconciliationService.reconcile.mockResolvedValue(
      succeed({ status: 'created', diff: -500 })
    );
    const importer = new AccountImporter(opts);
    const target = fakeBankTarget({ actualAccountId: ACCOUNT_ID, accounts: 'all', reconcile: true });
    const config = fakeBankConfig({ targets: [target] });
    const account = { accountNumber: '123456', txns: fakeBankTransactions(1), balance: 1000 };

    await importer.processAllAccounts('discount', config, makeScrapeResult([account]));

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('-5.00 ILS'));
  });

  it('defaults to empty accounts array when scrapeResult.accounts is undefined', async () => {
    const opts = makeOpts();
    const importer = new AccountImporter(opts);
    const config = fakeBankConfig();
    const result = await importer.processAllAccounts('discount', config, { success: true } as never);

    expect(result).toEqual({ imported: 0, skipped: 0 });
    expect(opts.transactionService.importTransactions).not.toHaveBeenCalled();
  });

  it('returns empty result for account with zero transactions after filtering', async () => {
    const opts = makeOpts();
    const importer = new AccountImporter(opts);
    const target = fakeBankTarget({ actualAccountId: ACCOUNT_ID, accounts: 'all', reconcile: false });
    const config = fakeBankConfig({ targets: [target] });
    const account = { accountNumber: '123456', txns: [], balance: undefined };

    const result = await importer.processAllAccounts('discount', config, makeScrapeResult([account]));

    expect(result).toEqual({ imported: 0, skipped: 0 });
    expect(opts.transactionService.importTransactions).not.toHaveBeenCalled();
  });
});
