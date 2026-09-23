/**
 * {@link SecureJsonStore} driven through {@link createNodeFileSystem} on a real disk.
 *
 * <p>Every other store test runs against {@link FakeFileSystem}, which stores
 * paths exactly as it is given them. A real directory listing does not: it
 * joins, and joining normalises. Nothing that only ever talks to the fake can
 * notice the difference, so the paths the store builds are proved here, where
 * the syscalls are real and the strings have to line up.
 */

import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import createNodeFileSystem from '../../src/Storage/NodeFileSystem.js';
import SecureJsonStore, { STALE_STAGING_AGE_MS } from '../../src/Storage/SecureJsonStore.js';

/** Temp directories to delete once the suite is done with them. */
const directories: string[] = [];

/** A staging name of the exact shape the sweep is willing to collect. */
const STAGED_TOKEN = '3f1a7c2e-9b4d-4e11-8a6f-2c5d7e9b1a30';

/**
 * Makes a temp directory that is removed when the suite finishes.
 * @returns Its absolute path.
 */
function makeDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'store-realfs-'));
  directories.push(directory);
  return directory;
}

/**
 * Backdates a file far enough that the sweep considers it abandoned.
 * @param filePath - Path to age.
 */
function ageBeyondStale(filePath: string): void {
  const staleMs = Date.now() - STALE_STAGING_AGE_MS * 2;
  const staleSeconds = staleMs / 1000;
  utimesSync(filePath, staleSeconds, staleSeconds);
}

afterEach(() => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

describe('SecureJsonStore on a real filesystem', () => {
  it('commits and reads back records through real syscalls', () => {
    const directory = makeDirectory();
    const store = new SecureJsonStore(createNodeFileSystem(), join(directory, 'tokens.json'));
    const records = { onezero: 'TOKEN-VALUE' };
    const committed = store.commit({ records, shouldQuarantine: false });
    if (!committed.success) throw new Error(`commit failed: ${committed.message}`);
    const snapshot = store.read();
    if (!snapshot.success) throw new Error(`read failed: ${snapshot.message}`);
    expect(snapshot.data.state).toBe('healthy');
    expect(snapshot.data.records).toEqual(records);
  });

  it('threat 22: sweeps abandoned staging even when the store path is not normalised', () => {
    const directory = makeDirectory();
    const storePath = join(directory, 'tokens.json');
    const abandoned = `${storePath}.${STAGED_TOKEN}.tmp`;
    writeFileSync(abandoned, '{"onezero":"LEAKED"}', { encoding: 'utf8', mode: 0o600 });
    ageBeyondStale(abandoned);
    const store = new SecureJsonStore(createNodeFileSystem(), `${directory}//./tokens.json`);
    const swept = store.sweepStagedLeftovers();
    if (!swept.success) throw new Error(`sweep failed: ${swept.message}`);
    expect(swept.data.removedCount).toBe(1);
    expect(() => statSync(abandoned)).toThrow();
  });

  it('threat 22: leaves the store itself alone when the path is not normalised', () => {
    const directory = makeDirectory();
    const store = new SecureJsonStore(createNodeFileSystem(), `${directory}//./tokens.json`);
    const committed = store.commit({ records: { kept: 'TOKEN' }, shouldQuarantine: false });
    if (!committed.success) throw new Error(`commit failed: ${committed.message}`);
    const swept = store.sweepStagedLeftovers();
    if (!swept.success) throw new Error(`sweep failed: ${swept.message}`);
    expect(swept.data.removedCount).toBe(0);
    expect(statSync(join(directory, 'tokens.json')).isFile()).toBe(true);
  });
});
