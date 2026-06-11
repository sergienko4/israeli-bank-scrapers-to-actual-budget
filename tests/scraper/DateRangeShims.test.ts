/**
 * DateRangeShims unit tests — exercises the extracted
 * `computeStartDate` and `filterTransactionsByDate` helpers in isolation.
 *
 * The same functions are also re-exported from BankScraper.ts and covered
 * indirectly by BankScraper.test.ts; these tests pin the behaviour at the
 * dedicated module's public surface so a future deletion of the BankScraper
 * re-exports (planned for Phase-3) does not lose coverage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  computeStartDate, filterTransactionsByDate,
} from '../../src/Scraper/DateRangeShims.js';
import { fakeBankConfig } from '../helpers/factories.js';

describe('DateRangeShims.computeStartDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes daysBack window inclusive of today (daysBack=1 => today)', () => {
    const cfg = fakeBankConfig({ daysBack: 1 });
    const start = computeStartDate(cfg);
    expect(start.toISOString().substring(0, 10)).toBe('2026-06-15');
  });

  it('subtracts daysBack-1 from today (daysBack=7 => six days ago)', () => {
    const cfg = fakeBankConfig({ daysBack: 7 });
    const start = computeStartDate(cfg);
    expect(start.toISOString().substring(0, 10)).toBe('2026-06-09');
  });

  it('uses startDate when daysBack is not set', () => {
    const cfg = fakeBankConfig({ daysBack: undefined, startDate: '2025-01-01' });
    const start = computeStartDate(cfg);
    expect(start.toISOString().substring(0, 10)).toBe('2025-01-01');
  });

  it('defaults to today when neither daysBack nor startDate is set', () => {
    const cfg = fakeBankConfig({ daysBack: undefined, startDate: undefined });
    const start = computeStartDate(cfg);
    expect(start.toISOString().substring(0, 10)).toBe('2026-06-15');
  });

  it('prefers daysBack over startDate when both are present', () => {
    const cfg = fakeBankConfig({ daysBack: 3, startDate: '2025-01-01' });
    const start = computeStartDate(cfg);
    expect(start.toISOString().substring(0, 10)).toBe('2026-06-13');
  });
});

describe('DateRangeShims.filterTransactionsByDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns input unchanged when neither daysBack nor startDate is configured', () => {
    const cfg = fakeBankConfig({ daysBack: undefined, startDate: undefined });
    const txns = [
      { date: '2020-01-01', amount: 1 },
      { date: '2026-06-15', amount: 2 },
    ];
    const out = filterTransactionsByDate(txns, cfg);
    expect(out).toBe(txns);
  });

  it('filters out transactions before the daysBack cutoff', () => {
    const cfg = fakeBankConfig({ daysBack: 3 });
    const txns = [
      { date: '2026-06-10', amount: 1 },
      { date: '2026-06-13', amount: 2 },
      { date: '2026-06-14', amount: 3 },
    ];
    const out = filterTransactionsByDate(txns, cfg);
    expect(out.map(t => t.amount)).toEqual([2, 3]);
  });

  it('filters out transactions before the explicit startDate cutoff', () => {
    const cfg = fakeBankConfig({ daysBack: undefined, startDate: '2026-06-12' });
    const txns = [
      { date: '2026-06-11', amount: 1 },
      { date: '2026-06-12', amount: 2 },
      { date: '2026-06-13', amount: 3 },
    ];
    const out = filterTransactionsByDate(txns, cfg);
    expect(out.map(t => t.amount)).toEqual([2, 3]);
  });

  it('preserves Date-typed transaction dates', () => {
    const cfg = fakeBankConfig({ daysBack: 5 });
    const txns = [
      { date: new Date('2026-06-09'), amount: 1 },
      { date: new Date('2026-06-12'), amount: 2 },
    ];
    const out = filterTransactionsByDate(txns, cfg);
    expect(out.map(t => t.amount)).toEqual([2]);
  });

  it('returns empty array when all transactions predate cutoff', () => {
    const cfg = fakeBankConfig({ daysBack: 2 });
    const txns = [
      { date: '2020-01-01', amount: 1 },
      { date: '2021-01-01', amount: 2 },
    ];
    const out = filterTransactionsByDate(txns, cfg);
    expect(out).toEqual([]);
  });

  it('returns all transactions when all are at/after cutoff', () => {
    const cfg = fakeBankConfig({ daysBack: 30 });
    const txns = [
      { date: '2026-06-10', amount: 1 },
      { date: '2026-06-14', amount: 2 },
    ];
    const out = filterTransactionsByDate(txns, cfg);
    expect(out.map(t => t.amount)).toEqual([1, 2]);
  });
});
