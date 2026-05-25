/**
 * BankRegistry tests — verifies alias resolution for every bank in the
 * default registry, plus failure modes for unknown banks.
 */

import { describe, it, expect } from 'vitest';

import { createBankRegistry, DEFAULT_BANK_REGISTRY } from '../../src/Scraper/BankRegistry.js';

const ALIAS_TO_BANK_ID: Record<string, string> = {
  hapoalim: 'hapoalim', leumi: 'leumi',
  discount: 'discount', mizrahi: 'mizrahi',
  mercantile: 'mercantile',
  otsarHahayal: 'otsarhahayal', otsarhahayal: 'otsarhahayal',
  beinleumi: 'beinleumi', massad: 'massad', yahav: 'yahav',
  visaCal: 'visacal', visacal: 'visacal',
  max: 'max', isracard: 'isracard', amex: 'amex',
  beyahadBishvilha: 'beyahadbishvilha', beyahadbishvilha: 'beyahadbishvilha',
  behatsdaa: 'behatsdaa', pagi: 'pagi',
  oneZero: 'onezero', onezero: 'onezero',
};

describe('createBankRegistry', () => {
  const registry = createBankRegistry();

  it('exposes 17 canonical bank entries', () => {
    expect(registry.list()).toHaveLength(17);
  });

  it.each(Object.entries(ALIAS_TO_BANK_ID))(
    'resolves alias %s to bankId %s',
    (alias, expectedBankId) => {
      const result = registry.resolve(alias);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.bankId).toBe(expectedBankId);
    },
  );

  it('resolves aliases case-insensitively', () => {
    const result = registry.resolve('HAPOALIM');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.bankId).toBe('hapoalim');
  });

  it('trims whitespace from alias before lookup', () => {
    const result = registry.resolve('  discount  ');
    expect(result.success).toBe(true);
  });

  it('returns failure result for unknown bank alias', () => {
    const result = registry.resolve('unknown-bank-xyz');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toContain('Unknown bank: unknown-bank-xyz');
      expect(result.status).toBe('unknown-bank');
    }
  });

  it('marks credit-card banks with flip-credit sign policy', () => {
    for (const id of ['visacal', 'max', 'isracard', 'amex']) {
      const result = registry.resolve(id);
      if (result.success) expect(result.data.signPolicy).toBe('flip-credit');
    }
  });

  it('marks regular banks with preserve sign policy', () => {
    for (const id of ['hapoalim', 'leumi', 'discount', 'mizrahi']) {
      const result = registry.resolve(id);
      if (result.success) expect(result.data.signPolicy).toBe('preserve');
    }
  });
});

describe('DEFAULT_BANK_REGISTRY', () => {
  it('is a usable singleton', () => {
    const result = DEFAULT_BANK_REGISTRY.resolve('hapoalim');
    expect(result.success).toBe(true);
  });
});
