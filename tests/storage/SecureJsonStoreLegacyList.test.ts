/**
 * The opt-in legacy list read of {@link SecureJsonStore}.
 *
 * <p>Some stores were written as a bare JSON list before they moved onto this
 * primitive. A store given a `legacyList` name reads such a file as one record
 * of that name, so the next commit writes the records form and nothing held in
 * the list is lost. A store given no name still treats a list as damage
 * (threat 24 in `docs/architecture/secure-json-store.md`).
 */

import { describe, expect, it } from 'vitest';

import SecureJsonStore from '../../src/Storage/SecureJsonStore.js';
import FakeFileSystem from './FakeFileSystem.js';

/** Path every case reads from. */
const STORE_PATH = '/data/audit-log.json';

/** Owner-only permissions. */
const OWNER_ONLY = 0o600;

/** Record name the legacy list is read under. */
const LIST_NAME = 'entries';

/** A list as an older release wrote it. */
const LEGACY_LIST = [{ timestamp: '2026-09-01T00:00:00.000Z' }, 'kept as written', 7];

/**
 * Builds a store that reads a legacy list, over a fresh in-memory filesystem.
 * @param contents - File contents to seed at the store path.
 * @returns The store under test and the filesystem behind it.
 */
function makeLegacyStore(contents: string): { store: SecureJsonStore; fileSystem: FakeFileSystem } {
  const fileSystem = new FakeFileSystem();
  fileSystem.seedFile(STORE_PATH, contents, OWNER_ONLY);
  const store = new SecureJsonStore(fileSystem, STORE_PATH, { legacyList: LIST_NAME });
  return { store, fileSystem };
}

describe('SecureJsonStore legacy list', () => {
  it('reads a list root as one healthy record under the legacy name', () => {
    const { store } = makeLegacyStore(JSON.stringify(LEGACY_LIST));
    const snapshot = store.read();
    if (!snapshot.success) throw new Error('expected the read to succeed');
    expect(snapshot.data.state).toBe('healthy');
    expect(snapshot.data.records).toEqual({ [LIST_NAME]: LEGACY_LIST });
  });

  it('says in the summary that the file was in the legacy form', () => {
    const { store } = makeLegacyStore('[]');
    const snapshot = store.read();
    expect(snapshot.success && snapshot.data.summary).toBe('Loaded the legacy list as entries');
  });

  it('reads an object root as records, exactly as a store with no legacy name does', () => {
    const records = { [LIST_NAME]: LEGACY_LIST, other: 'value' };
    const { store } = makeLegacyStore(JSON.stringify(records));
    const snapshot = store.read();
    expect(snapshot.success && snapshot.data.records).toEqual(records);
  });

  it.each([
    ['a bare string', '"entries"'],
    ['null', 'null'],
    ['a number', '42'],
    ['malformed JSON', '[{"timestamp":'],
  ])('threat 9: still reads %s as damage when a legacy name is given', (_label, contents) => {
    const { store } = makeLegacyStore(contents);
    const snapshot = store.read();
    expect(snapshot.success && snapshot.data.state).toBe('damaged');
  });

  it('threat 24: still reads a list root as damage when no legacy name is given', () => {
    const fileSystem = new FakeFileSystem();
    fileSystem.seedFile(STORE_PATH, JSON.stringify(LEGACY_LIST), OWNER_ONLY);
    const snapshot = new SecureJsonStore(fileSystem, STORE_PATH).read();
    expect(snapshot.success && snapshot.data.state).toBe('damaged');
  });

  it('replaces the legacy file with the records form on the next commit, losing nothing', () => {
    const { store, fileSystem } = makeLegacyStore(JSON.stringify(LEGACY_LIST));
    const snapshot = store.read();
    if (!snapshot.success) throw new Error('expected the read to succeed');
    store.commit({ records: snapshot.data.records, shouldQuarantine: false });
    const written: unknown = JSON.parse(fileSystem.contentsOf(STORE_PATH));
    expect(written).toEqual({ [LIST_NAME]: LEGACY_LIST });
  });
});
