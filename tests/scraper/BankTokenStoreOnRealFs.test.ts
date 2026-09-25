/**
 * {@link BankTokenStore} driven through {@link createNodeFileSystem} on a real disk.
 *
 * <p>Every other token-store case runs over the in-memory fake. This one
 * proves the adapter is wired to real syscalls end to end: a token survives a
 * round trip, lands owner-only, and a missing directory is reported rather
 * than thrown, because the store deliberately never creates one.
 */

import {
  existsSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import BankTokenStore from '../../src/Scraper/Tokens/BankTokenStore.js';
import createNodeFileSystem from '../../src/Storage/NodeFileSystem.js';
import { STALE_STAGING_AGE_MS } from '../../src/Storage/SecureJsonStore.js';
import { ACCOUNT_LOGIN, fakeToken } from './BankTokenStoreFixture.js';

/** Temp directories to delete once each case is done with them. */
const directories: string[] = [];

/** Owner read/write only. */
const OWNER_ONLY = 0o600;

/** Permission bits within a mode, excluding the file type. */
const PERMISSION_BITS = 0o777;

/** A staging name of the exact shape the sweep is willing to collect. */
const STAGED_TOKEN = '3f1a7c2e-9b4d-4e11-8a6f-2c5d7e9b1a30';

/**
 * Makes a temp directory that is removed after the case.
 * @returns Its absolute path.
 */
function makeDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'bank-tokens-realfs-'));
  directories.push(directory);
  return directory;
}

/**
 * Builds a store whose file lives in a fresh temp directory.
 * @returns The store and the path of its file.
 */
function makeStore(): { store: BankTokenStore; storePath: string } {
  const storePath = join(makeDirectory(), 'bank-tokens.json');
  return { store: new BankTokenStore(createNodeFileSystem(), storePath), storePath };
}

afterEach(() => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

describe('BankTokenStore on a real filesystem', () => {
  it('returns a written token from a later read', () => {
    const { store } = makeStore();
    const token = fakeToken();
    store.write('oneZero', token, ACCOUNT_LOGIN);
    expect(store.read('oneZero')).toMatchObject({ success: true, data: { record: { token: token } } });
  });

  it.skipIf(process.platform === 'win32')('creates the token file owner-only', () => {
    const { store, storePath } = makeStore();
    store.write('oneZero', fakeToken(), ACCOUNT_LOGIN);
    expect(statSync(storePath).mode & PERMISSION_BITS).toBe(OWNER_ONLY);
  });

  it('keeps two accounts side by side across separate writes', () => {
    const { store } = makeStore();
    const personal = fakeToken();
    const business = fakeToken();
    store.write('oneZero:personal', personal, ACCOUNT_LOGIN);
    store.write('oneZero:business', business, ACCOUNT_LOGIN);
    expect([store.read('oneZero:personal'), store.read('oneZero:business')])
      .toMatchObject([{ data: { record: { token: personal } } }, { data: { record: { token: business } } }]);
  });

  it('reports a missing directory as a failure instead of creating it', () => {
    const storePath = join(makeDirectory(), 'not-provisioned', 'bank-tokens.json');
    const store = new BankTokenStore(createNodeFileSystem(), storePath);
    expect(store.write('oneZero', fakeToken(), ACCOUNT_LOGIN)).toMatchObject({ success: false, status: 'ENOENT' });
  });

  it('collects a staged token an earlier run was killed before cleaning up', () => {
    const { store, storePath } = makeStore();
    const abandoned = `${storePath}.${STAGED_TOKEN}.tmp`;
    writeFileSync(abandoned, '{"oneZero":{"token":"left-behind"}}', { mode: OWNER_ONLY });
    const staleSeconds = (Date.now() - STALE_STAGING_AGE_MS * 2) / 1000;
    utimesSync(abandoned, staleSeconds, staleSeconds);
    const swept = store.sweepStagedLeftovers();
    const isGone = !existsSync(abandoned);
    expect({ swept, isGone })
      .toMatchObject({ swept: { success: true, data: { removedCount: 1 } }, isGone: true });
  });
});
