import { describe, expect, it } from 'vitest';

import { BANK_CATALOG } from '../../src/Types/BankCatalog.js';

// BANK_CATALOG feeds the Config manifest gate (ManifestGate) as the shared
// source of truth for supported banks, so its immutability is asserted here
// alongside the other config-layer guarantees.
describe('BANK_CATALOG immutability', () => {
  it('freezes the top-level catalog array', () => {
    expect(Object.isFrozen(BANK_CATALOG)).toBe(true);
  });

  it('freezes every catalog entry object', () => {
    const unfrozen = BANK_CATALOG.filter(entry => !Object.isFrozen(entry));
    expect(unfrozen).toEqual([]);
  });

  it('freezes the nested aliases array of every entry', () => {
    const unfrozen = BANK_CATALOG.filter(entry => !Object.isFrozen(entry.aliases));
    expect(unfrozen).toEqual([]);
  });

  it('rejects runtime mutation of an entry aliases array', () => {
    const [first] = BANK_CATALOG;
    expect(() => (first.aliases as string[]).push('injected')).toThrow(TypeError);
    expect(first.aliases).not.toContain('injected');
  });

  it('rejects reassignment of an entry field at runtime', () => {
    const [first] = BANK_CATALOG;
    expect(() => {
      (first as { bankId: string }).bankId = 'tampered';
    }).toThrow(TypeError);
    expect(first.bankId).not.toBe('tampered');
  });
});
