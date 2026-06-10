/**
 * Edge-case unit tests for ImportedIdBuilder — locks in the pure-function
 * contracts (deterministic SHA hash + legacy fallback + IBankTransaction
 * normalisation) introduced by the TransactionService split.
 *
 * Happy path is already exercised by tests/services/TransactionService.test.ts
 * end-to-end; this file covers only the builder-local branches that the
 * orchestrator does not assert against directly.
 */
import { describe, expect, it } from 'vitest';

import {
  buildImportedId,
  buildImportedIdLegacy,
  parseTransaction,
} from '../../../src/Services/Transaction/ImportedIdBuilder.js';
import type { IBankTransaction, ITransactionRecord } from '../../../src/Types/Index.js';

const baseParsed: ITransactionRecord = {
  date: '2026-02-14', description: 'Test', amount: -10000,
};
const baseTxn: IBankTransaction = {
  date: '2026-02-14', chargedAmount: -100, description: 'Test', identifier: '9999',
};

describe('buildImportedId', () => {
  it('returns a 16-char lowercase hex string', () => {
    const id = buildImportedId('discount-123', baseTxn, baseParsed);
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });

  it('is deterministic — identical content yields identical hash', () => {
    const a = buildImportedId('discount-123', baseTxn, baseParsed);
    const b = buildImportedId('discount-123', { ...baseTxn, identifier: 'changed' }, baseParsed);
    expect(b).toBe(a);
  });

  it('changes when accountKey changes', () => {
    const a = buildImportedId('discount-123', baseTxn, baseParsed);
    const b = buildImportedId('discount-456', baseTxn, baseParsed);
    expect(b).not.toBe(a);
  });

  it('treats missing description as empty string', () => {
    const { description: _omit, ...txnNoDesc } = baseTxn;
    const id = buildImportedId('discount-123', txnNoDesc, { ...baseParsed, description: '' });
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe('buildImportedIdLegacy', () => {
  it('uses identifier when present', () => {
    expect(buildImportedIdLegacy('discount-123', baseTxn, baseParsed))
      .toBe('discount-123-9999');
  });

  it('falls back to "date-amount" when identifier is missing', () => {
    const { identifier: _omit, ...txnNoId } = baseTxn;
    expect(buildImportedIdLegacy('discount-123', txnNoId, baseParsed))
      .toBe('discount-123-2026-02-14--100');
  });

  it('uses originalAmount in the fallback when chargedAmount is missing', () => {
    const txn: IBankTransaction = { date: '2026-02-14', originalAmount: -200, description: 'Test' };
    expect(buildImportedIdLegacy('discount-123', txn, baseParsed))
      .toBe('discount-123-2026-02-14--200');
  });
});

describe('parseTransaction', () => {
  it('formats date and converts chargedAmount to cents', () => {
    const r = parseTransaction({ date: '2026-02-14', chargedAmount: -10.5, description: 'X' });
    expect(r.date).toBe('2026-02-14');
    expect(r.amount).toBe(-1050);
    expect(r.description).toBe('X');
  });

  it('falls back to originalAmount when chargedAmount is missing', () => {
    const r = parseTransaction({ date: '2026-02-14', originalAmount: -25, description: 'Y' });
    expect(r.amount).toBe(-2500);
  });

  it('substitutes "Unknown" when description is missing', () => {
    const r = parseTransaction({ date: '2026-02-14', chargedAmount: -1 });
    expect(r.description).toBe('Unknown');
  });

  it('uses 0 amount when both chargedAmount and originalAmount are absent', () => {
    const r = parseTransaction({ date: '2026-02-14', description: 'Z' });
    expect(r.amount).toBe(0);
  });
});
