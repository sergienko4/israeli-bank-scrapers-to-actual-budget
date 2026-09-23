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

  it('rejects a relative override, which would resolve against the working directory', () => {
    process.env.BANK_TOKENS_PATH = 'data/bank-tokens.json';
    expect(() => resolveBankTokensPath()).toThrow(/absolute/iu);
  });

  it('keeps repeated and dot segments as written, since the OS resolves them the same way', () => {
    process.env.BANK_TOKENS_PATH = '/app/data//nested/./bank-tokens.json';
    expect(resolveBankTokensPath()).toBe('/app/data//nested/./bank-tokens.json');
  });

  it.each([
    ['in the middle', '/app/data/link/../bank-tokens.json'],
    ['at the end', '/app/data/nested/..'],
  ])('rejects a parent segment %s, which a symlink before it would redirect', (_where, override) => {
    process.env.BANK_TOKENS_PATH = override;
    expect(() => resolveBankTokensPath()).toThrow('BANK_TOKENS_PATH must not contain a ".." segment');
  });

  it('accepts a file name that only contains dots, which is not a parent segment', () => {
    process.env.BANK_TOKENS_PATH = '/app/data/..bank..tokens...json';
    expect(resolveBankTokensPath()).toBe('/app/data/..bank..tokens...json');
  });

  it('accepts a POSIX path that only resembles a Windows device prefix', () => {
    process.env.BANK_TOKENS_PATH = '//?/srv/bank-tokens.json';
    expect(resolveBankTokensPath()).toBe('//?/srv/bank-tokens.json');
  });

  it.each([
    ['a trailing separator', '/app/data/bank-tokens.json/'],
    ['repeated trailing separators', '/app/data/bank-tokens.json///'],
    ['the root', '/'],
    ['a final dot segment', '/app/data/.'],
  ])('rejects an override ending in %s, which names a directory', (_shape, override) => {
    process.env.BANK_TOKENS_PATH = override;
    expect(() => resolveBankTokensPath()).toThrow('BANK_TOKENS_PATH must name a file, not a directory');
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

    it('accepts a drive-letter file path as written', async () => {
      const resolved = await resolveAsWindows('C:\\data\\bank-tokens.json');
      expect(resolved).toBe('C:\\data\\bank-tokens.json');
    });

    it('accepts a file on a UNC share as written', async () => {
      const resolved = await resolveAsWindows('\\\\server\\share\\bank-tokens.json');
      expect(resolved).toBe('\\\\server\\share\\bank-tokens.json');
    });

    it.each([
      ['a backslash', '\\data\\bank-tokens.json'],
      ['a forward slash', '/data/bank-tokens.json'],
    ])('rejects a path rooted at %s with no drive, which follows the current drive', async (_root, override) => {
      await expect(resolveAsWindows(override)).rejects.toThrow('BANK_TOKENS_PATH must be an absolute path');
    });

    it.each([
      ['\\\\?\\C:\\data\\bank-tokens.json'],
      ['\\\\.\\C:\\data\\bank-tokens.json'],
      ['//?/C:/data/bank-tokens.json'],
      ['\\\\?\\UNC\\server\\share'],
    ])('rejects the device prefix in %s, which passes segments to the disk verbatim', async (override) => {
      await expect(resolveAsWindows(override))
        .rejects.toThrow('BANK_TOKENS_PATH must not use a \\\\?\\ or \\\\.\\ device prefix');
    });

    it.each([
      ['a drive root', 'C:\\'],
      ['a UNC share root, which has no trailing separator', '\\\\server\\share'],
      ['a trailing backslash', 'C:\\data\\bank-tokens.json\\'],
      ['a trailing forward slash, also a separator there', 'C:\\data\\bank-tokens.json/'],
    ])('rejects an override ending in %s', async (_shape, override) => {
      await expect(resolveAsWindows(override))
        .rejects.toThrow('BANK_TOKENS_PATH must name a file, not a directory');
    });

    it.each([
      ['between backslashes', 'C:\\data\\link\\..\\bank-tokens.json'],
      ['between forward slashes, also separators there', 'C:\\data/link/../bank-tokens.json'],
    ])('rejects a parent segment %s', async (_where, override) => {
      await expect(resolveAsWindows(override))
        .rejects.toThrow('BANK_TOKENS_PATH must not contain a ".." segment');
    });
  });
});