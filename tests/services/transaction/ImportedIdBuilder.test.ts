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
  buildContentKey,
  buildImportedId,
  buildImportedIdAt,
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

describe('buildContentKey', () => {
  it('joins accountKey, date, amount and description', () => {
    expect(buildContentKey('discount-123', baseTxn, baseParsed))
      .toBe('discount-123|2026-02-14|-10000|Test');
  });

  it('ignores identifier — identical charges share one key', () => {
    const a = buildContentKey('discount-123', baseTxn, baseParsed);
    const b = buildContentKey('discount-123', { ...baseTxn, identifier: 'other' }, baseParsed);
    expect(b).toBe(a);
  });

  it('treats missing description as empty string', () => {
    const { description: _omit, ...txnNoDesc } = baseTxn;
    expect(buildContentKey('discount-123', txnNoDesc, { ...baseParsed, description: '' }))
      .toBe('discount-123|2026-02-14|-10000|');
  });
});

describe('buildImportedIdAt', () => {
  const contentKey = 'discount-123|2026-02-14|-10000|Test';

  /*
   * Pinned literals, not computed expectations. A regression here means
   * previously-written imported_id values would stop matching, orphaning every
   * row already in a user's ledger and re-importing their whole history as
   * duplicates. That is the one outcome worse than the bug this suffix fixes,
   * so the occurrence-0 hash is frozen deliberately.
   */
  it('hashes the bare content key at occurrence 0', () => {
    expect(buildImportedIdAt(contentKey, 0)).toBe('a5a81e6729bc8dc1');
  });

  it('keeps occurrence 0 identical to the legacy-free buildImportedId', () => {
    expect(buildImportedIdAt(contentKey, 0)).toBe(
      buildImportedId('discount-123', baseTxn, baseParsed),
    );
  });

  it('gives later copies distinct, stable hashes', () => {
    expect(buildImportedIdAt(contentKey, 1)).toBe('f9b53b9864d9db9b');
    expect(buildImportedIdAt(contentKey, 2)).toBe('c6985a38d4787e3b');
  });

  /*
   * The occurrence marker is appended to the HASH of the content key, never to
   * the content key itself. Suffixing the raw key would let a charge whose
   * description happens to end in `|#1` claim the id belonging to its
   * neighbour's second copy, silently merging two unrelated charges.
   */
  it('does not confuse a later copy with a key that ends in the marker', () => {
    const plain = 'discount-123|2026-02-14|-10000|Coffee';
    const lookalike = 'discount-123|2026-02-14|-10000|Coffee|#1';
    expect(buildImportedIdAt(plain, 1)).not.toBe(buildImportedIdAt(lookalike, 0));
  });

  it('never collides across occurrences of the same charge', () => {
    const ids = [0, 1, 2, 3].map((n) => buildImportedIdAt(contentKey, n));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('treats a negative occurrence as occurrence 0', () => {
    expect(buildImportedIdAt(contentKey, -1)).toBe(buildImportedIdAt(contentKey, 0));
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
