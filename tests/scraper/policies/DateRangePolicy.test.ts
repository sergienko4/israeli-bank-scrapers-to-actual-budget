/**
 * DateRangePolicy tests — covers the date math previously triplicated
 * inside BankScraper (computeStartDate, filter, log).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createDateRangePolicy } from '../../../src/Scraper/Policies/DateRangePolicy.js';
import { fakeBankConfig } from '../../helpers/factories.js';

const FROZEN_NOW = new Date('2026-02-15T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createDateRangePolicy().computeStartDate', () => {
  const policy = createDateRangePolicy();

  it('returns today minus (daysBack - 1) when daysBack is set', () => {
    const config = fakeBankConfig({ daysBack: 7, startDate: undefined });
    const result = policy.computeStartDate(config);
    const expected = new Date();
    expected.setDate(expected.getDate() - 6);
    expect(result.toDateString()).toBe(expected.toDateString());
  });

  it('parses startDate string when provided', () => {
    const config = fakeBankConfig({ daysBack: undefined, startDate: '2026-01-01' });
    const result = policy.computeStartDate(config);
    expect(result.getFullYear()).toBe(2026);
  });

  it('returns today when neither is set', () => {
    const config = fakeBankConfig({ daysBack: undefined, startDate: undefined });
    const result = policy.computeStartDate(config);
    expect(result.toDateString()).toBe(new Date().toDateString());
  });

  it('falls back to today when daysBack is negative', () => {
    const config = fakeBankConfig({ daysBack: -5, startDate: undefined });
    const result = policy.computeStartDate(config);
    expect(result.toDateString()).toBe(new Date().toDateString());
  });

  it('falls back to today when daysBack is zero', () => {
    const config = fakeBankConfig({ daysBack: 0, startDate: undefined });
    const result = policy.computeStartDate(config);
    expect(result.toDateString()).toBe(new Date().toDateString());
  });

  it('falls back to today when startDate is unparseable', () => {
    const config = fakeBankConfig({ daysBack: undefined, startDate: 'not-a-date' });
    const result = policy.computeStartDate(config);
    expect(result.toDateString()).toBe(new Date().toDateString());
  });
});

describe('createDateRangePolicy().filterByDate', () => {
  const policy = createDateRangePolicy();

  it('passes through all transactions when no date filter is configured', () => {
    const config = fakeBankConfig({ daysBack: undefined, startDate: undefined });
    const txns = [{ date: '2020-01-01' }, { date: '2024-06-01' }];
    expect(policy.filterByDate(txns, config)).toHaveLength(2);
  });

  it('filters out transactions before the configured cutoff', () => {
    const config = fakeBankConfig({ daysBack: 7, startDate: undefined });
    const recent = { date: new Date().toISOString() };
    const old = { date: '2000-01-01' };
    const result = policy.filterByDate([recent, old], config);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(recent);
  });
});

describe('createDateRangePolicy().formatDateRange', () => {
  const policy = createDateRangePolicy();

  it('describes a daysBack window', () => {
    const config = fakeBankConfig({ daysBack: 7, startDate: undefined });
    expect(policy.formatDateRange(config)).toContain('last 7 days');
  });

  it('describes an absolute startDate', () => {
    const config = fakeBankConfig({ daysBack: undefined, startDate: '2026-01-01' });
    expect(policy.formatDateRange(config)).toContain('from 2026-01-01');
  });

  it('describes bank-default range when no filter is set', () => {
    const config = fakeBankConfig({ daysBack: undefined, startDate: undefined });
    expect(policy.formatDateRange(config)).toContain('bank default');
  });
});
