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
  mkdtempSync, readdirSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { stubRename, stubLstat, stubRm, stubClose } = vi.hoisted(() => ({
  stubRename: vi.fn(), stubLstat: vi.fn(), stubRm: vi.fn(), stubClose: vi.fn(),
}));

/** Fixed staging suffix so a test can plant a symlink where the write will land. */
const STAGING_SUFFIX = '11111111-2222-3333-4444-555555555555';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomUUID: () => STAGING_SUFFIX };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: stubRename,
    lstatSync: stubLstat,
    rmSync: stubRm,
    closeSync: stubClose,
  };
});

const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
const realRenameSync = realFs.renameSync;
const { default: BankTokenStore } = await import('../../src/Scraper/Tokens/BankTokenStore.js');
const { enforceOwnerOnly, isOccupied } = await import('../../src/Scraper/Tokens/StorePathGuards.js');

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
  stubRm.mockImplementation(realFs.rmSync);
  stubClose.mockImplementation(realFs.closeSync);
});

afterEach(() => {
  vi.clearAllMocks();
  realFs.rmSync(dir, { recursive: true, force: true });
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

describe('a cleanup that fails after the rename already failed', () => {
  beforeEach(() => {
    stubRename.mockImplementation((from: string) => {
      if (String(from).endsWith('.tmp')) throw new Error('EXDEV: cross-device link');
      return realRenameSync(from, storePath);
    });
    stubRm.mockImplementation((path: string) => {
      if (String(path).endsWith('.tmp')) throw new Error('EBUSY: sharing violation');
      return undefined;
    });
  });

  it('reports why the write failed, not why the cleanup did', () => {
    const result = new BankTokenStore(storePath).write('oneZero', 'onezero-id-token');
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.message).toContain('EXDEV');
  });

  it('never reports the cleanup error, which explains nothing to the operator', () => {
    const result = new BankTokenStore(storePath).write('oneZero', 'onezero-id-token');
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.message).not.toContain('EBUSY');
  });
});

describe('a symlink planted at the staging path', () => {
  let victim = '';

  beforeEach(() => {
    victim = join(dir, 'someone-elses-file.txt');
    writeFileSync(victim, 'ORIGINAL', { mode: 0o644 });
    symlinkSync(victim, `${storePath}.${STAGING_SUFFIX}.tmp`);
  });

  it('never writes the token through the link into another file', () => {
    new BankTokenStore(storePath).write('oneZero', 'onezero-id-token');
    expect(String(realFs.readFileSync(victim))).toBe('ORIGINAL');
  });

  it('reports the write as failed rather than claiming a stored token', () => {
    const result = new BankTokenStore(storePath).write('oneZero', 'onezero-id-token');
    expect(result.success).toBe(false);
  });

  it('leaves no token readable at the store path either', () => {
    const store = new BankTokenStore(storePath);
    store.write('oneZero', 'onezero-id-token');
    expect(store.read('oneZero')).toBe('');
  });
});

describe('a close that fails after the store was read', () => {
  beforeEach(() => {
    writeFileSync(storePath, JSON.stringify({
      version: 1,
      banks: { oneZero: { token: 'stored-id-token', capturedAt: '2026-01-01T00:00:00.000Z' } },
    }), { mode: 0o600 });
    stubClose.mockImplementation((descriptor: number) => {
      realFs.closeSync(descriptor);
      throw Object.assign(new Error('EIO: close failed'), { code: 'EIO' });
    });
  });

  it('still serves the token the read already returned', () => {
    expect(new BankTokenStore(storePath).read('oneZero')).toBe('stored-id-token');
  });

  it('never treats a healthy store as damaged, which would quarantine it', () => {
    new BankTokenStore(storePath).write('pepper', 'pepper-id-token');
    expect(readdirSync(dir).filter((name) => name.endsWith('.corrupt'))).toEqual([]);
  });

  it('keeps a sibling token that a mistaken quarantine would have stranded', () => {
    const store = new BankTokenStore(storePath);
    store.write('pepper', 'pepper-id-token');
    expect(store.read('oneZero')).toBe('stored-id-token');
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

  it('never re-permissions the swapped target while hardening', () => {
    const target = join(dir, 'someone-elses-secrets.json');
    realFs.chmodSync(target, 0o644);
    expect(enforceOwnerOnly(storePath)).toBe(false);
    expect(realFs.statSync(target).mode & 0o777).toBe(0o644);
  });
});

describe('a path the filesystem refuses to describe', () => {
  it('is treated as occupied, so damage is preserved rather than overwritten', () => {
    stubLstat.mockImplementation(() => { throw Object.assign(new Error('EIO'), { code: 'EIO' }); });
    expect(isOccupied(storePath)).toBe(true);
  });
});
