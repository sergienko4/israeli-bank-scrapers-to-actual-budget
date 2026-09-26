/**
 * How {@link OtpRequestStore} keeps its file safe on the shared volume.
 *
 * <p>The requests sit on {@link SecureJsonStore}: the file is owner-only and
 * holds one `requests` record, a list an older release wrote is read and then
 * written back in the records form, and a file holding anything the store
 * would not write back (including a malformed request it skips) is moved
 * aside on the next write. A write it cannot make throws instead of passing.
 */

import { describe, expect, it } from 'vitest';

import StorageError from '../../src/Errors/StorageError.js';
import OtpRequestStore from '../../src/Services/TwoFactor/OtpRequestStore.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';

/** Path every case reads and writes. */
const REQUESTS_PATH = '/data/otp-requests.json';

/** A predecessor moved aside by a quarantining commit. */
const QUARANTINED = /^\/data\/otp-requests\.json\.quarantined-/;

/** Clock every case runs at, epoch ms. */
const NOW = 1_000;

/** A live request as an older release stored it. */
const LIVE = { id: 'live', bankId: 'leumi', createdAt: NOW, deadline: NOW + 60_000 };

/**
 * Builds a store over a fresh in-memory filesystem, optionally seeding the file.
 * @param contents - File contents to seed, or undefined for no file.
 * @returns The store under test and the filesystem behind it.
 */
function makeStore(contents?: string): { store: OtpRequestStore; fileSystem: FakeFileSystem } {
  const fileSystem = new FakeFileSystem();
  if (contents !== undefined) fileSystem.seedFile(REQUESTS_PATH, contents, 0o644);
  const store = new OtpRequestStore(fileSystem, REQUESTS_PATH);
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
function storedJson(fileSystem: FakeFileSystem): { requests: { id: string; code?: string }[] } {
  return JSON.parse(fileSystem.contentsOf(REQUESTS_PATH)) as {
    requests: { id: string; code?: string }[];
  };
}

describe('OtpRequestStore on the secure store', () => {
  it('writes the requests owner-only', () => {
    const { store, fileSystem } = makeStore();
    store.create('leumi', 60_000, NOW);
    expect(fileSystem.modeOf(REQUESTS_PATH)).toBe(0o600);
  });

  it('writes the requests as the only record', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', 60_000, NOW);
    const stored = storedJson(fileSystem);
    expect(Object.keys(stored)).toEqual(['requests']);
    expect(stored.requests.map((request) => request.id)).toEqual([created.id]);
  });

  it('reads a list an older release wrote', () => {
    const { store } = makeStore(JSON.stringify([LIVE]));
    expect(store.get('live')?.bankId).toBe('leumi');
  });

  it('writes an older list back as the requests record, without moving it aside', () => {
    const { store, fileSystem } = makeStore(JSON.stringify([LIVE]));
    expect(store.submit('live', '123456', NOW)).toBe(true);
    expect(storedJson(fileSystem).requests).toEqual([{ ...LIVE, code: '123456' }]);
    expect(quarantinedNames(fileSystem)).toEqual([]);
  });

  it.each([
    ['text that is not JSON', 'not-json'],
    ['a root that is neither a list nor an object', JSON.stringify('x')],
    ['no requests record', JSON.stringify({})],
    ['a requests record that is not a list', JSON.stringify({ requests: '' })],
    ['a record besides the requests', JSON.stringify({ requests: [LIVE], extra: 1 })],
    ['a malformed request it skips', JSON.stringify({ requests: [LIVE, { id: 'x' }] })],
  ])('moves aside a file holding %s on the next write', (_label, contents) => {
    const { store, fileSystem } = makeStore(contents);
    store.create('discount', 60_000, NOW);
    expect(quarantinedNames(fileSystem)).toHaveLength(1);
  });

  it('keeps a file of well-formed requests in place on the next write', () => {
    const { store, fileSystem } = makeStore(JSON.stringify({ requests: [LIVE] }));
    store.create('discount', 60_000, NOW);
    expect(quarantinedNames(fileSystem)).toEqual([]);
    expect(storedJson(fileSystem).requests).toHaveLength(2);
  });

  it('prunes an expired request without moving the file aside', () => {
    const expired = { ...LIVE, id: 'old', deadline: NOW - 1 };
    const { store, fileSystem } = makeStore(JSON.stringify({ requests: [expired] }));
    store.create('discount', 60_000, NOW);
    expect(quarantinedNames(fileSystem)).toEqual([]);
    expect(store.get('old')).toBeNull();
  });

  it('saves onto no file without looking for one to move aside', () => {
    const { store, fileSystem } = makeStore();
    store.create('leumi', 60_000, NOW);
    expect(fileSystem.calls.filter((call) => call === 'openForRead')).toHaveLength(1);
  });

  it('writes nothing for a submit no request is waiting for', () => {
    const { store, fileSystem } = makeStore(JSON.stringify({ requests: [LIVE] }));
    expect(store.submit('missing', '123456', NOW)).toBe(false);
    expect(fileSystem.stagedPaths).toEqual([]);
  });

  it('keeps the old file and throws when the new one cannot be staged', () => {
    const { store, fileSystem } = makeStore(JSON.stringify({ requests: [LIVE] }));
    fileSystem.forcedFailures.set('createExclusive', 'ENOSPC');
    expect(() => store.submit('live', '123456', NOW)).toThrow(StorageError);
    expect(storedJson(fileSystem).requests).toEqual([LIVE]);
  });

  it.each([
    ['create', (store: OtpRequestStore): unknown => store.create('leumi', 60_000, NOW)],
    ['submit', (store: OtpRequestStore): unknown => store.submit('live', '123456', NOW)],
    ['remove', (store: OtpRequestStore): unknown => { store.remove('live'); return true; }],
  ])('refuses to %s over a file it cannot read', (_label, write) => {
    const { store, fileSystem } = makeStore(JSON.stringify({ requests: [LIVE] }));
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    expect(() => write(store)).toThrow(StorageError);
    expect(fileSystem.stagedPaths).toEqual([]);
  });

  it('reads no requests when the file cannot be read', () => {
    const { store, fileSystem } = makeStore(JSON.stringify({ requests: [LIVE] }));
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    expect(store.pending(NOW)).toEqual([]);
    expect(store.get('live')).toBeNull();
  });
});
