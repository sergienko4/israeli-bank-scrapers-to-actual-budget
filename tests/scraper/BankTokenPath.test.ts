import { afterEach, describe, expect, it, vi } from 'vitest';

const original = process.env.BANK_TOKENS_PATH;

/** Which `node:path` implementation a case runs under. */
type PathFlavour = 'posix' | 'win32';

/**
 * Resolves the store path with `node:path` behaving as it does on one platform.
 *
 * <p>The separator and the shape of a root are baked in at import time from
 * the running platform, so without this the host would decide which contract
 * a case exercises: on Windows, `/srv/x` is drive-relative and refused.
 * Loading the module fresh under one implementation makes every case mean the
 * same thing on any host.
 * @param flavour - Platform whose path rules apply.
 * @param override - Value for `BANK_TOKENS_PATH`, or undefined to unset it.
 * @returns The resolved store path under that platform's rules.
 */
async function resolveAs(flavour: PathFlavour, override: string | undefined): Promise<string> {
  vi.resetModules();
  vi.doMock('node:path', async () => {
    const actual = await vi.importActual<typeof import('node:path')>('node:path');
    const chosen = actual[flavour];
    return { ...chosen, default: chosen };
  });
  if (override === undefined) delete process.env.BANK_TOKENS_PATH;
  else process.env.BANK_TOKENS_PATH = override;
  const fresh = await import('../../src/Scraper/Tokens/BankTokenPath.js');
  return fresh.default();
}

describe('resolveBankTokensPath', () => {
  afterEach(() => {
    vi.doUnmock('node:path');
    vi.resetModules();
    if (original === undefined) {
      delete process.env.BANK_TOKENS_PATH;
    } else {
      process.env.BANK_TOKENS_PATH = original;
    }
  });

  describe('on a POSIX host', () => {
    it('returns the shared data-volume default when the env var is unset', async () => {
      await expect(resolveAs('posix', undefined)).resolves.toBe('/app/data/bank-tokens.json');
    });

    it('returns the default when the env var is whitespace-only', async () => {
      await expect(resolveAs('posix', '   ')).resolves.toBe('/app/data/bank-tokens.json');
    });

    it('honors an absolute override and trims surrounding whitespace', async () => {
      await expect(resolveAs('posix', '  /srv/shared/bank-tokens.json  '))
        .resolves.toBe('/srv/shared/bank-tokens.json');
    });

    it('rejects a relative override, which would resolve against the working directory', async () => {
      await expect(resolveAs('posix', 'data/bank-tokens.json')).rejects.toThrow(/absolute/iu);
    });

    it('keeps repeated and dot segments as written, since the OS resolves them the same way', async () => {
      await expect(resolveAs('posix', '/app/data//nested/./bank-tokens.json'))
        .resolves.toBe('/app/data//nested/./bank-tokens.json');
    });

    it.each([
      ['in the middle', '/app/data/link/../bank-tokens.json'],
      ['at the end', '/app/data/nested/..'],
    ])('rejects a parent segment %s, which a symlink before it would redirect', async (_where, override) => {
      await expect(resolveAs('posix', override))
        .rejects.toThrow('BANK_TOKENS_PATH must not contain a ".." segment');
    });

    it('accepts a file name that only contains dots, which is not a parent segment', async () => {
      await expect(resolveAs('posix', '/app/data/..bank..tokens...json'))
        .resolves.toBe('/app/data/..bank..tokens...json');
    });

    it('accepts a POSIX path that only resembles a Windows device prefix', async () => {
      await expect(resolveAs('posix', '//?/srv/bank-tokens.json'))
        .resolves.toBe('//?/srv/bank-tokens.json');
    });

    it.each([
      ['a trailing separator', '/app/data/bank-tokens.json/'],
      ['repeated trailing separators', '/app/data/bank-tokens.json///'],
      ['the root', '/'],
      ['a final dot segment', '/app/data/.'],
    ])('rejects an override ending in %s, which names a directory', async (_shape, override) => {
      await expect(resolveAs('posix', override))
        .rejects.toThrow('BANK_TOKENS_PATH must name a file, not a directory');
    });
  });

  describe('on a Windows host, where the root carries a drive letter', () => {
    it('accepts a drive-letter file path as written', async () => {
      await expect(resolveAs('win32', 'C:\\data\\bank-tokens.json'))
        .resolves.toBe('C:\\data\\bank-tokens.json');
    });

    it('accepts a file on a UNC share as written', async () => {
      await expect(resolveAs('win32', '\\\\server\\share\\bank-tokens.json'))
        .resolves.toBe('\\\\server\\share\\bank-tokens.json');
    });

    it.each([
      ['a backslash', '\\data\\bank-tokens.json'],
      ['a forward slash', '/data/bank-tokens.json'],
    ])('rejects a path rooted at %s with no drive, which follows the current drive', async (_root, override) => {
      await expect(resolveAs('win32', override)).rejects.toThrow('BANK_TOKENS_PATH must be an absolute path');
    });

    it.each([
      ['\\\\?\\C:\\data\\bank-tokens.json'],
      ['\\\\.\\C:\\data\\bank-tokens.json'],
      ['//?/C:/data/bank-tokens.json'],
      ['\\\\?\\UNC\\server\\share'],
    ])('rejects the device prefix in %s, which passes segments to the disk verbatim', async (override) => {
      await expect(resolveAs('win32', override))
        .rejects.toThrow('BANK_TOKENS_PATH must not use a \\\\?\\ or \\\\.\\ device prefix');
    });

    it.each([
      ['a drive root', 'C:\\'],
      ['a UNC share root, which has no trailing separator', '\\\\server\\share'],
      ['a trailing backslash', 'C:\\data\\bank-tokens.json\\'],
      ['a trailing forward slash, also a separator there', 'C:\\data\\bank-tokens.json/'],
    ])('rejects an override ending in %s', async (_shape, override) => {
      await expect(resolveAs('win32', override))
        .rejects.toThrow('BANK_TOKENS_PATH must name a file, not a directory');
    });

    it.each([
      ['between backslashes', 'C:\\data\\link\\..\\bank-tokens.json'],
      ['between forward slashes, also separators there', 'C:\\data/link/../bank-tokens.json'],
    ])('rejects a parent segment %s', async (_where, override) => {
      await expect(resolveAs('win32', override))
        .rejects.toThrow('BANK_TOKENS_PATH must not contain a ".." segment');
    });
  });
});
