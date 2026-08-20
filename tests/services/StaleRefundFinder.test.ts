/**
 * StaleRefundFinder tests.
 *
 * Guards the one-off migration that removes credit-card refund rows the
 * importer wrote with an inverted sign under scraper 8.6.6. The critical
 * assertions are the NEGATIVE ones: the matcher must refuse to flag any
 * bucket it cannot prove is a clean stale/corrected pair, because every
 * flagged row is a deletion candidate against real financial data.
 */

import { describe, expect, it } from 'vitest';

import type { IStaleRefundRow } from '../../src/Services/Transaction/StaleRefundFinder.js';
import findStaleRefundCandidates from '../../src/Services/Transaction/StaleRefundFinder.js';

/**
 * Builds an Actual Budget row with importer-written defaults.
 * @param overrides - Fields to override on the default row.
 * @returns A row shaped for the matcher.
 */
function row(overrides: Partial<IStaleRefundRow>): IStaleRefundRow {
  return {
    id: 'row-1',
    date: '2026-08-01',
    amount: -5000,
    imported_id: 'hash-1',
    imported_payee: 'SUPER PHARM',
    ...overrides,
  };
}

/**
 * Builds the canonical stale pair: a wrong -50 and its corrected +50.
 * @returns The two rows a VisaCal refund leaves behind after the upgrade.
 */
function stalePair(): IStaleRefundRow[] {
  return [
    row({ id: 'stale', amount: -5000, imported_id: 'hash-stale' }),
    row({ id: 'corrected', amount: 5000, imported_id: 'hash-corrected' }),
  ];
}

describe('findStaleRefundCandidates', () => {
  it('flags the negative row of a stale/corrected pair', () => {
    const candidates = findStaleRefundCandidates(stalePair());
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.staleRowId).toBe('stale');
    expect(candidates[0]?.correctedRowId).toBe('corrected');
  });

  it('reports both signed amounts so operators can eyeball the pair', () => {
    const [candidate] = findStaleRefundCandidates(stalePair());
    expect(candidate?.staleAmount).toBe(-5000);
    expect(candidate?.correctedAmount).toBe(5000);
    expect(candidate?.description).toBe('SUPER PHARM');
  });

  it('returns nothing when only the corrected row exists', () => {
    const rows = [row({ id: 'corrected', amount: 5000 })];
    expect(findStaleRefundCandidates(rows)).toEqual([]);
  });

  it('returns nothing when only the stale row exists', () => {
    expect(findStaleRefundCandidates([row({ id: 'stale' })])).toEqual([]);
  });

  it('ignores rows whose magnitudes differ', () => {
    const rows = [
      row({ id: 'stale', amount: -5000 }),
      row({ id: 'other', amount: 7500, imported_id: 'hash-other' }),
    ];
    expect(findStaleRefundCandidates(rows)).toEqual([]);
  });

  it('ignores rows on different dates', () => {
    const rows = [
      row({ id: 'stale', amount: -5000 }),
      row({ id: 'other', amount: 5000, date: '2026-08-02', imported_id: 'hash-other' }),
    ];
    expect(findStaleRefundCandidates(rows)).toEqual([]);
  });

  it('ignores rows from different merchants', () => {
    const rows = [
      row({ id: 'stale', amount: -5000 }),
      row({ id: 'other', amount: 5000, imported_payee: 'SHUFERSAL', imported_id: 'hash-2' }),
    ];
    expect(findStaleRefundCandidates(rows)).toEqual([]);
  });

  it('skips hand-entered rows that carry no imported_id', () => {
    const rows = [
      row({ id: 'stale', amount: -5000, imported_id: null }),
      row({ id: 'corrected', amount: 5000, imported_id: 'hash-corrected' }),
    ];
    expect(findStaleRefundCandidates(rows)).toEqual([]);
  });

  it('skips a bucket holding a genuine purchase alongside the pair', () => {
    const rows = [
      ...stalePair(),
      row({ id: 'genuine', amount: -5000, imported_id: 'hash-genuine' }),
    ];
    expect(findStaleRefundCandidates(rows)).toEqual([]);
  });

  it('skips two same-signed rows that share a bucket', () => {
    const rows = [
      row({ id: 'a', amount: -5000, imported_id: 'hash-a' }),
      row({ id: 'b', amount: -5000, imported_id: 'hash-b' }),
    ];
    expect(findStaleRefundCandidates(rows)).toEqual([]);
  });

  it('ignores zero-amount rows', () => {
    const rows = [
      row({ id: 'a', amount: 0, imported_id: 'hash-a' }),
      row({ id: 'b', amount: 0, imported_id: 'hash-b' }),
    ];
    expect(findStaleRefundCandidates(rows)).toEqual([]);
  });

  it('finds independent pairs across different merchants and dates', () => {
    const rows = [
      ...stalePair(),
      row({ id: 's2', amount: -2000, date: '2026-07-05', imported_payee: 'MAX', imported_id: 'h3' }),
      row({ id: 'c2', amount: 2000, date: '2026-07-05', imported_payee: 'MAX', imported_id: 'h4' }),
    ];
    const candidates = findStaleRefundCandidates(rows);
    expect(candidates.map((c) => c.staleRowId)).toEqual(['s2', 'stale']);
  });

  it('returns an empty list for an empty account', () => {
    expect(findStaleRefundCandidates([])).toEqual([]);
  });

  it('treats a null payee as an empty merchant key', () => {
    const rows = [
      row({ id: 'stale', amount: -5000, imported_payee: null }),
      row({ id: 'corrected', amount: 5000, imported_payee: null, imported_id: 'hash-c' }),
    ];
    expect(findStaleRefundCandidates(rows)[0]?.description).toBe('');
  });

  it('does not mutate the input array', () => {
    const rows = stalePair();
    findStaleRefundCandidates(rows);
    expect(rows.map((r) => r.id)).toEqual(['stale', 'corrected']);
  });
});
