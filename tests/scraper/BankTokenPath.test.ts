import { afterEach, describe, expect, it } from 'vitest';

import resolveBankTokensPath from '../../src/Scraper/Tokens/BankTokenPath.js';

const original = process.env.BANK_TOKENS_PATH;

describe('resolveBankTokensPath', () => {
  afterEach(() => {
    if (original === undefined) {
      delete process.env.BANK_TOKENS_PATH;
    } else {
      process.env.BANK_TOKENS_PATH = original;
    }
  });

  it('returns the shared data-volume default when the env var is unset', () => {
    delete process.env.BANK_TOKENS_PATH;
    expect(resolveBankTokensPath()).toBe('/app/data/bank-tokens.json');
  });

  it('returns the default when the env var is whitespace-only', () => {
    process.env.BANK_TOKENS_PATH = '   ';
    expect(resolveBankTokensPath()).toBe('/app/data/bank-tokens.json');
  });

  it('honors an absolute override and trims surrounding whitespace', () => {
    process.env.BANK_TOKENS_PATH = '  /srv/shared/bank-tokens.json  ';
    expect(resolveBankTokensPath()).toBe('/srv/shared/bank-tokens.json');
  });

  it('rejects a relative override so importer and portal cannot diverge', () => {
    process.env.BANK_TOKENS_PATH = 'data/bank-tokens.json';
    expect(() => resolveBankTokensPath()).toThrow(/absolute/iu);
  });

  it('normalises a traversal-laden override to its real destination', () => {
    process.env.BANK_TOKENS_PATH = '/app/data/../../etc/bank-tokens.json';
    expect(resolveBankTokensPath()).toBe('/etc/bank-tokens.json');
  });

  it('strips a trailing separator so one path never yields two store files', () => {
    process.env.BANK_TOKENS_PATH = '/app/data//nested/./bank-tokens.json';
    expect(resolveBankTokensPath()).toBe('/app/data/nested/bank-tokens.json');
  });
});