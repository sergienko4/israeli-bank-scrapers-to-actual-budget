/**
 * DefaultScrapeResultMapper tests — covers canonical mapping, sign
 * policy dispatch, and the legacy back-adapter.
 */

import { describe, it, expect } from 'vitest';

import createScrapeResultMapper from '../../../src/Scraper/Mappers/DefaultScrapeResultMapper.js';
import type { IRawScrape } from '../../../src/Types/Index.js';

/**
 * Builds an IRawScrape envelope for mapper tests.
 * @param bankId - Bank id to embed.
 * @param accounts - Provider accounts (raw shape).
 * @returns Frozen IRawScrape suitable for mapToCanonical().
 */
function makeRaw(bankId: string, accounts: unknown[]): IRawScrape {
  return {
    bankId, companyType: bankId as never,
    attemptCount: 1, strategy: 'live',
    raw: { success: true, accounts: accounts as never },
  };
}

const mapper = createScrapeResultMapper();
const startDate = new Date('2026-01-01');
const endDate = new Date('2026-01-31');

describe('DefaultScrapeResultMapper.mapToCanonical', () => {
  it('produces canonical metadata from inputs', () => {
    const raw = makeRaw('discount', []);
    const canonical = mapper.mapToCanonical({
      raw, signPolicy: 'preserve', startDate, endDate,
    });
    expect(canonical.bankId).toBe('discount');
    expect(canonical.metadata.signPolicyApplied).toBe('preserve');
    expect(canonical.metadata.strategy).toBe('live');
    expect(canonical.metadata.attemptCount).toBe(1);
    expect(canonical.metadata.startDate).toBe('2026-01-01');
    expect(canonical.metadata.endDate).toBe('2026-01-31');
  });

  it('flips signs for flip-credit policy', () => {
    const raw = makeRaw('visacal', [{
      accountNumber: '9', balance: 0,
      txns: [{ chargedAmount: 100, originalAmount: 50, date: '2026-01-01' }],
    }]);
    const canonical = mapper.mapToCanonical({
      raw, signPolicy: 'flip-credit', startDate, endDate,
    });
    expect(canonical.accounts[0].txns[0].chargedAmount).toBe(-100);
    expect(canonical.accounts[0].txns[0].originalAmount).toBe(-50);
  });

  it('preserves signs for preserve policy', () => {
    const raw = makeRaw('discount', [{
      accountNumber: '9', balance: 0,
      txns: [{ chargedAmount: 100, originalAmount: 50, date: '2026-01-01' }],
    }]);
    const canonical = mapper.mapToCanonical({
      raw, signPolicy: 'preserve', startDate, endDate,
    });
    expect(canonical.accounts[0].txns[0].chargedAmount).toBe(100);
    expect(canonical.accounts[0].txns[0].originalAmount).toBe(50);
  });

  it('handles raw scrapes with no accounts', () => {
    const raw = makeRaw('discount', []);
    const canonical = mapper.mapToCanonical({
      raw, signPolicy: 'preserve', startDate, endDate,
    });
    expect(canonical.accounts).toHaveLength(0);
  });
});

describe('DefaultScrapeResultMapper.canonicalToLegacy', () => {
  it('passes through provider failures unchanged', () => {
    const raw = makeRaw('discount', []);
    const canonical = mapper.mapToCanonical({
      raw, signPolicy: 'preserve', startDate, endDate,
    });
    const failure = { success: false as const, errorMessage: 'boom', accounts: [] };
    const legacy = mapper.canonicalToLegacy(canonical, failure);
    expect(legacy.success).toBe(false);
    expect(legacy.errorMessage).toBe('boom');
  });

  it('rebuilds accounts on the legacy shape', () => {
    const raw = makeRaw('discount', [{
      accountNumber: 'A1', balance: 42,
      txns: [{ chargedAmount: 1, originalAmount: 1, date: '2026-01-01' }],
    }]);
    const canonical = mapper.mapToCanonical({
      raw, signPolicy: 'preserve', startDate, endDate,
    });
    const legacy = mapper.canonicalToLegacy(canonical, raw.raw);
    expect(legacy.accounts?.[0].accountNumber).toBe('A1');
    expect(legacy.accounts?.[0].balance).toBe(42);
    expect(legacy.accounts?.[0].txns).toHaveLength(1);
  });
});
