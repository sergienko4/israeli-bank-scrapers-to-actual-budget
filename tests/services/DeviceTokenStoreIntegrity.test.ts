/**
 * How {@link DeviceTokenStore} keeps its file safe on the shared volume.
 *
 * <p>The store sits on {@link SecureJsonStore}: the file is owner-only and
 * holds one `tokens` record, a list an older release wrote is read and then
 * written back in the records form, and a file holding anything this store
 * would not write back is moved aside on the next write.
 */

import { describe, expect, it } from 'vitest';

import StorageError from '../../src/Errors/StorageError.js';
import DeviceTokenStore from '../../src/Services/Notifications/DeviceTokenStore.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';
import seedStaleStaged from '../storage/StaleStaging.js';

/** Path every case reads and writes. */
const DEVICES_PATH = '/data/devices.json';

/** A predecessor moved aside by a quarantining commit. */
const QUARANTINED = /^\/data\/devices\.json\.quarantined-/;

/**
 * Builds a store over a fresh in-memory filesystem, optionally seeding the file.
 * @param contents - File contents to seed, or undefined for no file.
 * @returns The store under test and the filesystem behind it.
 */
function makeStore(contents?: string): { store: DeviceTokenStore; fileSystem: FakeFileSystem } {
  const fileSystem = new FakeFileSystem();
  if (contents !== undefined) fileSystem.seedFile(DEVICES_PATH, contents, 0o644);
  const store = new DeviceTokenStore(fileSystem, DEVICES_PATH);
  return { store, fileSystem };
}

/**
 * Lists the quarantined predecessors on the filesystem.
 * @param fileSystem - Filesystem to inspect.
 * @returns Every quarantined name.
 */
function quarantinedNames(fileSystem: FakeFileSystem): string[] {
  return fileSystem.names().filter((name) => QUARANTINED.test(name));
}

/**
 * Parses the stored file.
 * @param fileSystem - Filesystem holding the file.
 * @returns The parsed contents.
 */
function storedJson(fileSystem: FakeFileSystem): unknown {
  return JSON.parse(fileSystem.contentsOf(DEVICES_PATH));
}

describe('DeviceTokenStore on the secure store', () => {
  it('writes the tokens owner-only', () => {
    const { store, fileSystem } = makeStore();
    store.add('a');
    expect(fileSystem.modeOf(DEVICES_PATH)).toBe(0o600);
  });

  it('writes the tokens as the only record', () => {
    const { store, fileSystem } = makeStore();
    store.add('a');
    expect(storedJson(fileSystem)).toEqual({ tokens: ['a'] });
  });

  it('reads a list an older release wrote', () => {
    const { store } = makeStore(JSON.stringify(['a', 'b']));
    expect(store.list()).toEqual(['a', 'b']);
  });

  it('writes an older list back as the tokens record, without moving it aside', () => {
    const { store, fileSystem } = makeStore(JSON.stringify(['a', 'b']));
    store.add('c');
    expect(storedJson(fileSystem)).toEqual({ tokens: ['a', 'b', 'c'] });
    expect(quarantinedNames(fileSystem)).toEqual([]);
  });

  it.each([
    ['text that is not JSON', 'not-json'],
    ['a root that is neither a list nor an object', JSON.stringify('a')],
    ['no tokens record', JSON.stringify({})],
    ['a tokens record that is not a list', JSON.stringify({ tokens: 'a' })],
    ['a record besides the tokens', JSON.stringify({ tokens: ['a'], extra: 1 })],
    ['a token that is not a string', JSON.stringify({ tokens: ['a', 1] })],
    ['an older list with a token that is not a string', JSON.stringify(['a', 1])],
  ])('moves aside a file holding %s on the next write', (_label, contents) => {
    const { store, fileSystem } = makeStore(contents);
    store.add('z');
    expect(quarantinedNames(fileSystem)).toHaveLength(1);
    expect(storedJson(fileSystem)).toEqual({ tokens: expect.arrayContaining(['z']) as unknown });
  });

  it('keeps the string tokens of a file with one that is not a string', () => {
    const { store, fileSystem } = makeStore(JSON.stringify({ tokens: ['a', 1] }));
    store.add('z');
    expect(storedJson(fileSystem)).toEqual({ tokens: ['a', 'z'] });
  });

  it('overwrites an intact file without moving it aside', () => {
    const { store, fileSystem } = makeStore(JSON.stringify({ tokens: ['a'] }));
    store.remove('a');
    expect(storedJson(fileSystem)).toEqual({ tokens: [] });
    expect(quarantinedNames(fileSystem)).toEqual([]);
  });

  it('saves onto no file without looking for one to move aside', () => {
    const { store, fileSystem } = makeStore();
    store.add('a');
    expect(fileSystem.calls.filter((call) => call === 'openForRead')).toHaveLength(1);
  });

  it('writes nothing when the token is already registered', () => {
    const { store, fileSystem } = makeStore(JSON.stringify({ tokens: ['a'] }));
    store.add('a');
    expect(fileSystem.stagedPaths).toEqual([]);
  });

  it('keeps the old file and throws when the new one cannot be staged', () => {
    const { store, fileSystem } = makeStore(JSON.stringify({ tokens: ['a'] }));
    fileSystem.forcedFailures.set('createExclusive', 'ENOSPC');
    expect(() => {
      store.add('b');
    }).toThrow(StorageError);
    expect(storedJson(fileSystem)).toEqual({ tokens: ['a'] });
  });

  it.each(['add', 'remove'] as const)('throws without writing when %s cannot read the file', (action) => {
    const { store, fileSystem } = makeStore(JSON.stringify({ tokens: ['a'] }));
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    expect(() => {
      store[action]('b');
    }).toThrow(/device tokens/);
    expect(fileSystem.stagedPaths).toEqual([]);
  });

  it('lists no tokens when the file cannot be read', () => {
    const { store, fileSystem } = makeStore(JSON.stringify({ tokens: ['a'] }));
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    expect(store.list()).toEqual([]);
  });

  it('sweeps a staged file an earlier run left behind', () => {
    const { store, fileSystem } = makeStore();
    const staged = seedStaleStaged(fileSystem, DEVICES_PATH);
    const swept = store.sweepStagedLeftovers();
    expect(swept.success && swept.data.removedCount).toBe(1);
    expect(fileSystem.hasEntry(staged)).toBe(false);
  });
});
