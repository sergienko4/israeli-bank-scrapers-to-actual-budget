/**
 * BankTokenStore boundary tests — covers the two filesystem outcomes that
 * cannot be produced with a real volume.
 *
 * <p>A real rename onto the store path cannot be made to fail while the
 * store still reads as writable: everything that breaks the rename — a
 * directory, a dangling link — is classified as damage first and refused
 * before a temp file is ever staged.
 *
 * <p>A symlink swapped in between classification and read cannot be timed
 * from a test either. Making `lstat` answer what the pre-swap check saw
 * reproduces the attacker's win deterministically.
 *
 * <p>Those two calls are stubbed; every other filesystem call is the real
 * one, including the writes and reads being asserted on.
 */

import {
  mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { stubRename, stubLstat } = vi.hoisted(() => ({
  stubRename: vi.fn(), stubLstat: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: stubRename, lstatSync: stubLstat };
});

const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
const realRenameSync = realFs.renameSync;
const { default: BankTokenStore } = await import('../../src/Scraper/Tokens/BankTokenStore.js');

let dir = '';
let storePath = '';

/**
 * Lists the staged temp files still sitting next to the store.
 * @returns Names of every leftover temp file.
 */
function tempFilesInStoreDir(): string[] {
  return readdirSync(dir).filter((name) => name.endsWith('.tmp'));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bank-token-commit-'));
  storePath = join(dir, 'bank-tokens.json');
  stubRename.mockImplementation(realRenameSync);
  stubLstat.mockImplementation(realFs.lstatSync);
});

afterEach(() => {
  vi.clearAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('a rename that fails after the payload is staged', () => {
  beforeEach(() => {
    stubRename.mockImplementation((from: string) => {
      if (String(from).endsWith('.tmp')) throw new Error('EXDEV: cross-device link');
      return realRenameSync(from, storePath);
    });
  });

  it('reports a typed failure rather than throwing at the caller', () => {
    const result = new BankTokenStore(storePath).write('oneZero', 'onezero-id-token');
    expect(result.success).toBe(false);
  });

  it('removes the staged temp file, which holds a live credential', () => {
    new BankTokenStore(storePath).write('oneZero', 'onezero-id-token');
    expect(tempFilesInStoreDir()).toEqual([]);
  });

  it('leaves no store behind, so the next run mints a fresh token', () => {
    const store = new BankTokenStore(storePath);
    store.write('oneZero', 'onezero-id-token');
    expect(store.read('oneZero')).toBe('');
  });
});

describe('a rename that succeeds', () => {
  it('stages a temp file and then leaves none behind', () => {
    const store = new BankTokenStore(storePath);
    expect(store.write('oneZero', 'onezero-id-token').success).toBe(true);
    expect(tempFilesInStoreDir()).toEqual([]);
    expect(store.read('oneZero')).toBe('onezero-id-token');
  });
});

describe('a symlink swapped in after the path was classified', () => {
  beforeEach(() => {
    const target = join(dir, 'someone-elses-secrets.json');
    const stolen = { banks: { oneZero: { token: 'not-ours', capturedAt: '2026-01-01T00:00:00.000Z' } } };
    writeFileSync(target, JSON.stringify(stolen));
    symlinkSync(target, storePath);
    // What the check saw a moment before the swap: a plain regular file.
    stubLstat.mockImplementation((path: string) => realFs.statSync(path));
  });

  it('never serves the swapped target as this importer\'s tokens', () => {
    expect(new BankTokenStore(storePath).read('oneZero')).toBe('');
  });

  it('leaves the swapped target untouched', () => {
    new BankTokenStore(storePath).read('oneZero');
    const target = join(dir, 'someone-elses-secrets.json');
    expect(String(realFs.readFileSync(target))).toContain('not-ours');
  });
});
