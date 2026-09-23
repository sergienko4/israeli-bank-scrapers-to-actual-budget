/**
 * Read-path behaviour of {@link SecureJsonStore}.
 *
 * <p>Every case here maps to a numbered row of the threat model in
 * `plans/secure-json-store-spec.md`. The row is named in the test title so a
 * future reader can tell which guard a failure has removed.
 *
 * <p>Runs entirely against {@link FakeFileSystem}: no temp directories, no
 * `vi.mock`, and errnos that would be awkward to provoke for real.
 */

import { describe, expect, it } from 'vitest';

import SecureJsonStore from '../../src/Storage/SecureJsonStore.js';
import { MAX_STORE_BYTES } from '../../src/Storage/StoreRecords.js';
import FakeFileSystem from './FakeFileSystem.js';

/** Path every case reads from. */
const STORE_PATH = '/data/tokens.json';

/** Owner-only permissions. */
const OWNER_ONLY = 0o600;

/** A credential value no error message may ever repeat. */
const SECRET = 'eyJhbGciOiJIUzI1NiJ9.super-secret-refresh-token';

/**
 * Builds a store over a fresh in-memory filesystem.
 * @returns The store under test and the filesystem behind it.
 */
function makeStore(): { store: SecureJsonStore; fileSystem: FakeFileSystem } {
  const fileSystem = new FakeFileSystem();
  return { store: new SecureJsonStore(fileSystem, STORE_PATH), fileSystem };
}

describe('SecureJsonStore read path', () => {
  it('reports an absent store as absent, which is a cold start and not damage', () => {
    const { store } = makeStore();
    const snapshot = store.read();
    expect(snapshot.success && snapshot.data.state).toBe('absent');
  });

  it('returns the stored records when the file is healthy', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, JSON.stringify({ 'onezero:main': SECRET }), OWNER_ONLY);
    const snapshot = store.read();
    expect(snapshot.success && snapshot.data.records['onezero:main']).toBe(SECRET);
  });

  it('threat 3: learns absence from one lookup, leaving no check-then-use window', () => {
    const { store, fileSystem } = makeStore();
    store.read();
    expect(fileSystem.calls.filter((call) => call === 'openForRead')).toHaveLength(1);
  });

  it('threat 4: treats a directory at the path as damage rather than parsing it', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedDirectory(STORE_PATH);
    const snapshot = store.read();
    expect(snapshot.success && snapshot.data.state).toBe('damaged');
  });

  it('threat 8: rejects an oversized file without ever reading it into memory', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, 'x'.repeat(MAX_STORE_BYTES + 1), OWNER_ONLY);
    const snapshot = store.read();
    expect(snapshot.success && snapshot.data.state).toBe('damaged');
    expect(fileSystem.calls).not.toContain('readAll');
  });

  it('threat 8: accepts a file exactly at the cap, so the limit is not off by one', () => {
    const { store, fileSystem } = makeStore();
    const padding = 'x'.repeat(MAX_STORE_BYTES - '{"k":""}'.length);
    fileSystem.seedFile(STORE_PATH, `{"k":"${padding}"}`, OWNER_ONLY);
    const snapshot = store.read();
    expect(snapshot.success && snapshot.data.state).toBe('healthy');
  });

  it('threat 9: classifies malformed JSON as damage, not as an empty store', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, '{"onezero":', OWNER_ONLY);
    const snapshot = store.read();
    expect(snapshot.success && snapshot.data.state).toBe('damaged');
  });

  it('threat 9: reports no records when damaged, yet never claims the store is absent', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, 'not json at all', OWNER_ONLY);
    const snapshot = store.read();
    if (!snapshot.success) throw new Error('expected the read to succeed');
    expect(Object.keys(snapshot.data.records)).toHaveLength(0);
    expect(snapshot.data.state).toBe('damaged');
  });

  it('threat 9: treats a JSON array as damage, because records must be keyed', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, '["onezero"]', OWNER_ONLY);
    const snapshot = store.read();
    expect(snapshot.success && snapshot.data.state).toBe('damaged');
  });

  it('threat 9: treats a bare JSON string as damage', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, '"just-a-string"', OWNER_ONLY);
    const snapshot = store.read();
    expect(snapshot.success && snapshot.data.state).toBe('damaged');
  });

  it('threat 9: treats JSON null as damage rather than an empty record set', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, 'null', OWNER_ONLY);
    const snapshot = store.read();
    expect(snapshot.success && snapshot.data.state).toBe('damaged');
  });

  it('threat 10: returns a null-prototype record set, so a merge cannot climb it', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, '{"onezero:main":"t"}', OWNER_ONLY);
    const snapshot = store.read();
    expect(snapshot.success && Object.getPrototypeOf(snapshot.data.records)).toBeNull();
  });

  it('threat 10: drops a __proto__ key instead of handing it to a careless caller', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, '{"__proto__":{"polluted":true},"real":"t"}', OWNER_ONLY);
    const snapshot = store.read();
    if (!snapshot.success) throw new Error('expected the read to succeed');
    expect(Object.hasOwn(snapshot.data.records, '__proto__')).toBe(false);
    expect(snapshot.data.records['real']).toBe('t');
  });

  it('threat 10: leaves Object.prototype unpolluted after reading a hostile file', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, '{"__proto__":{"polluted":true}}', OWNER_ONLY);
    store.read();
    expect('polluted' in {}).toBe(false);
  });

  it('threat 11: never repeats the stored token in a damage summary', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, `{"onezero":"${SECRET}"`, OWNER_ONLY);
    const snapshot = store.read();
    expect(snapshot.success && snapshot.data.summary).not.toContain(SECRET);
  });

  it('threat 11: never repeats the stored token in a read failure message', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, `{"onezero":"${SECRET}"}`, OWNER_ONLY);
    fileSystem.forcedFailures.set('readAll', 'EIO');
    const snapshot = store.read();
    expect(snapshot.success).toBe(false);
    expect(snapshot.success ? '' : snapshot.message).not.toContain(SECRET);
  });

  it('threat 1: treats a symlink squatting the path as damage, never following it', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile('/data/someone-elses.json', 'theirs', OWNER_ONLY);
    fileSystem.seedSymlink(STORE_PATH, '/data/someone-elses.json');
    const snapshot = store.read();
    expect(snapshot.success && snapshot.data.state).toBe('damaged');
  });

  it('threat 7: takes a world-readable store down to owner-only while reading it', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, '{"a":"b"}', 0o644);
    store.read();
    expect(fileSystem.modeOf(STORE_PATH)).toBe(OWNER_ONLY);
  });

  it('threat 7: still returns the records when hardening is refused', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, '{"a":"b"}', 0o644);
    fileSystem.forcedFailures.set('restrictToOwner', 'EPERM');
    const snapshot = store.read();
    expect(snapshot.success && snapshot.data.records['a']).toBe('b');
  });

  it('reports a permission error as a failure, not as absence or damage', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    const snapshot = store.read();
    expect(snapshot.success).toBe(false);
  });

  it('reports an obstructed parent as a failure, not as a cold start', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.forcedFailures.set('openForRead', 'ENOTDIR');
    const snapshot = store.read();
    expect(snapshot.success).toBe(false);
  });

  it('threat 8: treats a store that grew past the cap mid-read as damaged', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, '{"a":"b"}', OWNER_ONLY);
    fileSystem.forcedFailures.set('readAll', 'EFBIG');
    const snapshot = store.read();
    if (!snapshot.success) throw new Error('expected an overgrown store to be reported, not thrown');
    expect(snapshot.data.state).toBe('damaged');
  });

  it('releases the descriptor on every path, including the damaged one', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, 'not json', OWNER_ONLY);
    store.read();
    expect(fileSystem.calls).toContain('close');
  });
});
