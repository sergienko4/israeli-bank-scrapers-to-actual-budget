/**
 * {@link SecureJsonStore.commitNew}: a write that only claims a free name.
 *
 * <p>For a file two processes race to create, where exactly one must win and
 * the other must learn it lost. The records are staged and checked as for a
 * commit, then published only if the name is free; a taken name is left as
 * it was, and no staged copy survives any outcome.
 */

import { describe, expect, it } from 'vitest';

import SecureJsonStore from '../../src/Storage/SecureJsonStore.js';
import { MAX_STORE_BYTES } from '../../src/Storage/StoreRecords.js';
import FakeFileSystem from './FakeFileSystem.js';

/** Path every case publishes to. */
const STORE_PATH = '/data/answer.json';

/** Records every case publishes unless it says otherwise. */
const RECORDS = { requestId: 'r-1', deadline: 5_000, code: '123456' };

/**
 * Builds a store over a fresh in-memory filesystem with its directory.
 * @returns The store under test and the filesystem behind it.
 */
function makeStore(): { store: SecureJsonStore; fileSystem: FakeFileSystem } {
  const fileSystem = new FakeFileSystem();
  fileSystem.seedDirectory('/data');
  const store = new SecureJsonStore(fileSystem, STORE_PATH);
  return { store, fileSystem };
}

/**
 * Lists every name besides the directory itself.
 * @param fileSystem - Filesystem to inspect.
 * @returns The names inside `/data`.
 */
function filesIn(fileSystem: FakeFileSystem): string[] {
  return fileSystem.names().filter((name) => name !== '/data');
}

describe('SecureJsonStore.commitNew', () => {
  it('publishes the records whole, owner-only, at a free name', () => {
    const { store, fileSystem } = makeStore();
    const committed = store.commitNew(RECORDS);
    expect(committed.success).toBe(true);
    expect(JSON.parse(fileSystem.contentsOf(STORE_PATH))).toEqual(RECORDS);
    expect(fileSystem.modeOf(STORE_PATH)).toBe(0o600);
  });

  it('reports the path and the record count, and quarantines nothing', () => {
    const { store } = makeStore();
    const committed = store.commitNew(RECORDS);
    expect(committed.success && committed.data).toEqual({
      path: STORE_PATH, wasQuarantined: false, summary: 'Committed 3 records',
    });
  });

  it('leaves no staged copy after publishing', () => {
    const { store, fileSystem } = makeStore();
    store.commitNew(RECORDS);
    expect(filesIn(fileSystem)).toEqual([STORE_PATH]);
  });

  it('refuses a taken name with EEXIST, leaving it as it was and no staged copy', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, '{"expired":true}', 0o600);
    const committed = store.commitNew(RECORDS);
    expect(committed.success ? 'published' : committed.status).toBe('EEXIST');
    expect(fileSystem.contentsOf(STORE_PATH)).toBe('{"expired":true}');
    expect(filesIn(fileSystem)).toEqual([STORE_PATH]);
  });

  it('publishes through the exclusive publish, never a replacing rename', () => {
    const { store, fileSystem } = makeStore();
    store.commitNew(RECORDS);
    expect(fileSystem.calls).toContain('publishExclusive');
    expect(fileSystem.calls).not.toContain('rename');
  });

  it('removes the staged copy and reports the errno when publishing fails', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.forcedFailures.set('publishExclusive', 'EPERM');
    const committed = store.commitNew(RECORDS);
    expect(committed.success ? 'published' : committed.status).toBe('EPERM');
    expect(filesIn(fileSystem)).toEqual([]);
  });

  it('publishes nothing when the records cannot be staged', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.forcedFailures.set('createExclusive', 'ENOSPC');
    const committed = store.commitNew(RECORDS);
    expect(committed.success ? 'published' : committed.status).toBe('ENOSPC');
    expect(fileSystem.calls).not.toContain('publishExclusive');
    expect(filesIn(fileSystem)).toEqual([]);
  });

  it('publishes nothing and removes the stage when the staged write is short', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.shortWriteOnCall(1);
    const committed = store.commitNew(RECORDS);
    expect(committed.success).toBe(false);
    expect(fileSystem.calls).not.toContain('publishExclusive');
    expect(filesIn(fileSystem)).toEqual([]);
  });

  it('stages nothing for records too large to write', () => {
    const { store, fileSystem } = makeStore();
    const committed = store.commitNew({ blob: 'x'.repeat(MAX_STORE_BYTES) });
    expect(committed.success ? 'published' : committed.status).toBe('EFBIG');
    expect(fileSystem.stagedPaths).toEqual([]);
  });

  it('stages nothing for records that cannot be serialised', () => {
    const { store, fileSystem } = makeStore();
    const committed = store.commitNew({ amount: 1n });
    expect(committed.success ? 'published' : committed.status).toBe('EINVAL');
    expect(fileSystem.stagedPaths).toEqual([]);
  });

  it('stages nothing for a request it cannot own', () => {
    const { store, fileSystem } = makeStore();
    const committed = store.commitNew(null as unknown as Record<string, unknown>);
    expect(committed.success).toBe(false);
    expect(fileSystem.stagedPaths).toEqual([]);
  });
});
