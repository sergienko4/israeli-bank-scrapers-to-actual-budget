import { describe, it, expect } from 'vitest';
import { CompanyTypes, createScraper } from '@sergienko4/israeli-bank-scrapers';

/**
 * Upstream-contract tests against `@sergienko4/israeli-bank-scrapers`.
 *
 * Unlike the unit tests in `BankScraper.test.ts` which mock the scraper
 * package to test our own glue code, this file imports the REAL upstream
 * exports. Its job is to fail loudly when a future bump breaks our
 * integration surface — the way the 8.3.0 minor bump silently removed
 * `.initialize()`/`.terminate()` and re-cased `CompanyTypes` keys.
 *
 * If this file goes red after a `npm update`, treat it as a breaking
 * change in the dep regardless of the version tag.
 */

describe('israeli-bank-scrapers public API contract', () => {
  it('exports CompanyTypes as a non-empty object', () => {
    expect(CompanyTypes).toBeTypeOf('object');
    expect(Object.keys(CompanyTypes).length).toBeGreaterThan(0);
  });

  it('every CompanyTypes value is a non-empty string', () => {
    for (const [name, id] of Object.entries(CompanyTypes)) {
      expect(id, `CompanyTypes.${name}`).toBeTypeOf('string');
      expect((id as string).length, `CompanyTypes.${name}`).toBeGreaterThan(0);
    }
  });

  it('createScraper accepts every CompanyTypes value and returns a usable instance', () => {
    for (const [name, id] of Object.entries(CompanyTypes)) {
      const scraper = createScraper({
        companyId: id as never,
        startDate: new Date(),
      });
      expect(scraper, `createScraper(${name})`).toBeDefined();
      expect(
        typeof scraper.scrape,
        `createScraper(${name}).scrape must be a function`,
      ).toBe('function');
    }
  });

  it('lowercased CompanyTypes keys still cover the canonical bank set', () => {
    // ConfigValidator derives its allow-list from
    // `Object.keys(CompanyTypes).map(k => k.toLowerCase())`. This locks
    // the contract that lowercasing the keys yields a stable set of
    // user-facing bank identifiers — independent of whether upstream
    // exports them in camelCase or PascalCase.
    const lowered = new Set(Object.keys(CompanyTypes).map((k) => k.toLowerCase()));
    const knownCore = ['hapoalim', 'leumi', 'discount', 'max', 'isracard'];
    for (const bank of knownCore) {
      expect(lowered.has(bank), `lowercased CompanyTypes must include "${bank}"`).toBe(true);
    }
  });
});
