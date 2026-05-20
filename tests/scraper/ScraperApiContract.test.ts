import { describe, it, expect } from 'vitest';
import { CompanyTypes, createScraper } from '@sergienko4/israeli-bank-scrapers';

/**
 * Upstream-contract tests against `@sergienko4/israeli-bank-scrapers`.
 *
 * Unlike the unit tests in `BankScraper.test.ts` which mock the scraper
 * package to test our own glue code, this file imports the REAL upstream
 * exports. Its job is to fail loudly when a future bump breaks our
 * integration surface — the way a previous minor bump silently removed
 * `.initialize()`/`.terminate()` and re-cased `CompanyTypes` keys.
 *
 * If this file goes red after a `npm update`, treat it as a breaking
 * change in the dep regardless of the version tag.
 */

/**
 * Value type of any `CompanyTypes` member. Using this (instead of
 * `as never`) keeps the test type-safe: if upstream narrows or renames
 * `companyId`'s expected type, this entry array stops compiling and the
 * contract test fails at build time as intended.
 */
type CompanyId = (typeof CompanyTypes)[keyof typeof CompanyTypes];

/** Typed enumeration of every `(key, value)` in `CompanyTypes`. */
const COMPANY_ENTRIES: ReadonlyArray<readonly [keyof typeof CompanyTypes, CompanyId]> =
  Object.entries(CompanyTypes) as ReadonlyArray<
    readonly [keyof typeof CompanyTypes, CompanyId]
  >;

describe('israeli-bank-scrapers public API contract', () => {
  it('exports CompanyTypes as a non-empty object', () => {
    expect(CompanyTypes).toBeTypeOf('object');
    expect(COMPANY_ENTRIES.length).toBeGreaterThan(0);
  });

  it('every CompanyTypes value is a non-empty string', () => {
    for (const [name, id] of COMPANY_ENTRIES) {
      expect(id, `CompanyTypes.${name}`).toBeTypeOf('string');
      expect(id.length, `CompanyTypes.${name}`).toBeGreaterThan(0);
    }
  });

  it('createScraper accepts every CompanyTypes value and returns a usable instance', () => {
    for (const [name, id] of COMPANY_ENTRIES) {
      const scraper = createScraper({
        companyId: id,
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
    const lowered = new Set(COMPANY_ENTRIES.map(([k]) => k.toLowerCase()));
    const knownCore = ['hapoalim', 'leumi', 'discount', 'max', 'isracard'];
    for (const bank of knownCore) {
      expect(lowered.has(bank), `lowercased CompanyTypes must include "${bank}"`).toBe(true);
    }
  });
});
