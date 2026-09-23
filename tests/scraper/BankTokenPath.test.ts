import { afterEach, describe, expect, it, vi } from 'vitest';

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

  it('collapses repeated and dot segments so one path never yields two stores', () => {
    process.env.BANK_TOKENS_PATH = '/app/data//nested/./bank-tokens.json';
    expect(resolveBankTokensPath()).toBe('/app/data/nested/bank-tokens.json');
  });

  it('strips a trailing separator, which would otherwise name the directory', () => {
    process.env.BANK_TOKENS_PATH = '/app/data/bank-tokens.json/';
    expect(resolveBankTokensPath()).toBe('/app/data/bank-tokens.json');
  });

  it('strips repeated trailing separators too', () => {
    process.env.BANK_TOKENS_PATH = '/app/data/bank-tokens.json///';
    expect(resolveBankTokensPath()).toBe('/app/data/bank-tokens.json');
  });

  it('keeps the root separator, which is the path rather than a trailing one', () => {
    process.env.BANK_TOKENS_PATH = '/';
    expect(resolveBankTokensPath()).toBe('/');
  });

  describe('on a Windows host, where the root carries a drive letter', () => {
    /**
     * Resolves the path with `node:path` behaving as it does on Windows.
     *
     * <p>The separator and the shape of a root are baked in at import time
     * from the running platform, so POSIX test runners can never reach the
     * drive-letter branch. Substituting the win32 implementation exercises
     * the contract an operator on Windows actually gets.
     * @param override - Value to place in `BANK_TOKENS_PATH`.
     * @returns The resolved store path under win32 semantics.
     */
    async function resolveAsWindows(override: string): Promise<string> {
      vi.resetModules();
      vi.doMock('node:path', async () => {
        const actual = await vi.importActual<typeof import('node:path')>('node:path');
        return { ...actual.win32, default: actual.win32 };
      });
      process.env.BANK_TOKENS_PATH = override;
      const fresh = await import('../../src/Scraper/Tokens/BankTokenPath.js');
      return fresh.default();
    }

    afterEach(() => {
      vi.doUnmock('node:path');
      vi.resetModules();
    });

    it('keeps a drive root absolute rather than making it drive-relative', async () => {
      const resolved = await resolveAsWindows('C:\\');
      expect(resolved).toBe('C:\\');
    });

    it('still strips a trailing separator from a real file path', async () => {
      const resolved = await resolveAsWindows('C:\\data\\bank-tokens.json\\');
      expect(resolved).toBe('C:\\data\\bank-tokens.json');
    });
  });
});