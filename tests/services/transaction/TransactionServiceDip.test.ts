/**
 * TransactionService DIP proof — the import orchestrator depends on the
 * ITransactionBatchImporter abstraction, not the concrete TransactionBatchImporter.
 *
 * Test cases (test-cases guideline, 10-field):
 *  - TXN-DIP-01 (positive): a minimal ITransactionBatchImporter fake drives
 *    importTransactions; the returned IImportResult maps the fake's outcome
 *    (imported = new count, skipped = existing count). Proves the seam — if
 *    TransactionService still required the concrete class, the fake would not
 *    type-check as the injected importer.
 *  - TXN-DIP-02 (negative): a fake whose processBatch rejects makes
 *    importTransactions resolve to a failure Procedure (no throw, graceful),
 *    wrapping the underlying error message.
 */

import type api from '@actual-app/api';
import { faker } from '@faker-js/faker';
import { describe, it, expect, vi } from 'vitest';
import {
  TransactionService, type IImportTransactionsOpts,
} from '../../../src/Services/TransactionService.js';
import type {
  IBatchOutcome, ITransactionBatchImporter,
} from '../../../src/Services/Transaction/TransactionBatchImporter.js';
import type { ITransactionRecord } from '../../../src/Types/Index.js';
import { assertProcedureSuccess, fakeTransactionRecord } from '../../helpers/factories.js';

vi.mock('../../../src/Logger/Index.js', () => ({
  getLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createLogger: vi.fn(),
  deriveLogFormat: vi.fn().mockReturnValue('words'),
}));

/** No-op Actual API stub — TransactionService only stores it for the account/dedup collaborators. */
const STUB_API = {} as unknown as typeof api;

/** Builds import options; content is irrelevant since the injected fake returns a fixed outcome. */
function buildOpts(): IImportTransactionsOpts {
  return {
    bankName: 'hapoalim',
    accountNumber: faker.finance.accountNumber(),
    actualAccountId: faker.string.uuid(),
    transactions: [],
  };
}

describe('TransactionService DIP — orchestrator depends on the ITransactionBatchImporter abstraction', () => {
  it('TXN-DIP-01: maps an injected fake importer outcome to imported/skipped counts', async () => {
    const newTransactions: ITransactionRecord[] = [fakeTransactionRecord(), fakeTransactionRecord()];
    const existingTransactions: ITransactionRecord[] = [fakeTransactionRecord()];
    const outcome: IBatchOutcome = { newTransactions, existingTransactions };
    const fakeImporter: ITransactionBatchImporter = {
      processBatch: vi.fn().mockResolvedValue(outcome),
    };

    const service = new TransactionService(STUB_API, undefined, fakeImporter);
    const opts = buildOpts();
    const result = await service.importTransactions(opts);

    assertProcedureSuccess(result);
    expect(fakeImporter.processBatch).toHaveBeenCalledOnce();
    expect(fakeImporter.processBatch).toHaveBeenCalledWith(opts);
    expect(result.data.imported).toBe(2);
    expect(result.data.skipped).toBe(1);
    expect(result.data.newTransactions).toEqual(newTransactions);
    expect(result.data.existingTransactions).toEqual(existingTransactions);
  });

  it('TXN-DIP-02: wraps a failing fake importer as a failure Procedure (no throw)', async () => {
    const fakeImporter: ITransactionBatchImporter = {
      processBatch: vi.fn().mockRejectedValue(new Error('actual db unavailable')),
    };

    const service = new TransactionService(STUB_API, undefined, fakeImporter);
    const result = await service.importTransactions(buildOpts());

    expect(result.success).toBe(false);
    expect(fakeImporter.processBatch).toHaveBeenCalledOnce();
    if (!result.success) {
      expect(result.message).toContain('actual db unavailable');
    }
  });
});
