/**
 * CardRefundCleanup tests.
 *
 * Covers the I/O half of the 8.6.7 sign migration: account scoping,
 * the report-only default, the `--confirm` deletion path, and the
 * guarantee that only the wrongly-signed row of a pair is ever deleted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IImporterConfig } from '../../src/Types/Index.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: (): typeof mockLogger => mockLogger,
}));

const { mockApi } = vi.hoisted(() => {
  const select = vi.fn().mockReturnValue({ __query: true });
  const filter = vi.fn().mockReturnValue({ select });
  return {
    mockApi: {
      init: vi.fn(),
      downloadBudget: vi.fn(),
      shutdown: vi.fn(),
      aqlQuery: vi.fn(),
      deleteTransaction: vi.fn(),
      q: vi.fn().mockReturnValue({ filter }),
    },
  };
});
vi.mock('@actual-app/api', () => ({ default: mockApi }));

import runCardRefundCleanup from '../../src/Services/Transaction/CardRefundCleanup.js';

const ACTUAL_SECTION = {
  init: { dataDir: './data', serverURL: 'https://budget.local', password: 'pw' },
  budget: { syncId: 'sync-1', password: null },
};

/**
 * Builds a config whose banks map is supplied by the caller.
 * @param banks - The banks section to embed in the config.
 * @returns A config object shaped for the cleanup command.
 */
function configWith(banks: Record<string, unknown>): IImporterConfig {
  const config = { actual: ACTUAL_SECTION, banks };
  return config as unknown as IImporterConfig;
}

/**
 * Builds a bank entry pointing at a single Actual account.
 * @param accountId - The Actual account UUID the bank targets.
 * @returns A bank config with one target.
 */
function bankTargeting(accountId: string): Record<string, unknown> {
  return { targets: [{ actualAccountId: accountId, reconcile: false, accounts: 'all' }] };
}

/**
 * Builds the canonical stale/corrected pair for one merchant and date.
 * @returns Two rows that the matcher recognises as a stale pair.
 */
function stalePairRows(): Record<string, unknown>[] {
  return [
    { id: 'stale', date: '2026-08-01', amount: -5000, imported_id: 'h1', imported_payee: 'CAL' },
    { id: 'ok', date: '2026-08-01', amount: 5000, imported_id: 'h2', imported_payee: 'CAL' },
  ];
}

describe('runCardRefundCleanup', () => {
  let originalArgv: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    originalArgv = process.argv;
    process.argv = ['node', 'index.js', '--cleanup-card-refunds'];
    mockApi.init.mockResolvedValue(undefined);
    mockApi.downloadBudget.mockResolvedValue(undefined);
    mockApi.deleteTransaction.mockResolvedValue(undefined);
    mockApi.shutdown.mockResolvedValue(undefined);
    mockApi.aqlQuery.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('returns 1 and logs when Actual cannot be reached', async () => {
    mockApi.init.mockRejectedValue(new Error('cannot reach server'));

    expect(await runCardRefundCleanup(configWith({}))).toBe(1);
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('cannot reach server'));
  });

  it('shuts the API down even when the run fails', async () => {
    mockApi.init.mockRejectedValue(new Error('cannot reach server'));

    await runCardRefundCleanup(configWith({}));

    expect(mockApi.shutdown).toHaveBeenCalledTimes(1);
  });

  it('connects with the configured credentials and budget', async () => {
    await runCardRefundCleanup(configWith({}));

    expect(mockApi.init).toHaveBeenCalledWith(ACTUAL_SECTION.init);
    expect(mockApi.downloadBudget).toHaveBeenCalledWith('sync-1', { password: undefined });
  });

  it('queries credit-card accounts only, skipping non-card banks', async () => {
    await runCardRefundCleanup(
      configWith({
        visaCal: bankTargeting('card-account'),
        hapoalim: bankTargeting('bank-account'),
      }),
    );

    expect(mockApi.q().filter).toHaveBeenCalledWith({ account: 'card-account' });
    expect(mockApi.q().filter).not.toHaveBeenCalledWith({ account: 'bank-account' });
  });

  it('reports a clean slate and returns 0 when nothing matches', async () => {
    const config = configWith({ max: bankTargeting('a1') });

    expect(await runCardRefundCleanup(config)).toBe(0);
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('nothing to clean up'));
    expect(mockApi.deleteTransaction).not.toHaveBeenCalled();
  });

  it('reports candidates without deleting when --confirm is absent', async () => {
    mockApi.aqlQuery.mockResolvedValue({ data: stalePairRows() });
    const config = configWith({ visaCal: bankTargeting('a1') });

    expect(await runCardRefundCleanup(config)).toBe(0);
    expect(mockApi.deleteTransaction).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('re-run with --confirm'));
  });

  it('always prints the ambiguity warning alongside candidates', async () => {
    mockApi.aqlQuery.mockResolvedValue({ data: stalePairRows() });

    await runCardRefundCleanup(configWith({ visaCal: bankTargeting('a1') }));

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('WARNING'));
  });

  it('deletes only the wrongly-signed row when --confirm is present', async () => {
    process.argv = ['node', 'index.js', '--cleanup-card-refunds', '--confirm'];
    mockApi.aqlQuery.mockResolvedValue({ data: stalePairRows() });
    const config = configWith({ visaCal: bankTargeting('a1') });

    expect(await runCardRefundCleanup(config)).toBe(0);
    expect(mockApi.deleteTransaction).toHaveBeenCalledTimes(1);
    expect(mockApi.deleteTransaction).toHaveBeenCalledWith('stale');
  });

  it('tolerates Actual returning no data field', async () => {
    mockApi.aqlQuery.mockResolvedValue(null);

    expect(await runCardRefundCleanup(configWith({ amex: bankTargeting('a1') }))).toBe(0);
  });

  it('handles a card bank configured without any targets', async () => {
    expect(await runCardRefundCleanup(configWith({ isracard: {} }))).toBe(0);
    expect(mockApi.aqlQuery).not.toHaveBeenCalled();
  });

  it('returns 1 when the Actual query throws', async () => {
    mockApi.aqlQuery.mockRejectedValue(new Error('server down'));
    const config = configWith({ visaCal: bankTargeting('a1') });

    expect(await runCardRefundCleanup(config)).toBe(1);
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('server down'));
  });
});
