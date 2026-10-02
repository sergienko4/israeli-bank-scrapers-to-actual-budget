/**
 * How {@link AppTokenStore} keeps its file safe on the shared volume.
 *
 * <p>The store sits on {@link SecureJsonStore}: the file is owner-only and
 * holds one `tokens` record, a list an older release wrote is read and then
 * written back in the records form, and a file holding anything this store
 * would not write back is moved aside on the next write. A write that cannot
 * read the current file throws instead of replacing it, so an unreadable file
 * never signs every other phone out.
 */

import { describe, expect, it } from 'vitest';

import StorageError from '../../src/Errors/StorageError.js';
import type { IAppTokenRecord, TokenGrant } from '../../src/Portal/AppTokenStore.js';
import { AppTokenStore, ROTATION_OVERLAP_MS } from '../../src/Portal/AppTokenStore.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';
import seedStaleStaged from '../storage/StaleStaging.js';

/** Path every case reads and writes. */
const TOKENS_PATH = '/data/app-tokens.json';

/** A predecessor moved aside by a quarantining commit. */
const QUARANTINED = /^\/data\/app-tokens\.json\.quarantined-/;

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const GRANT: TokenGrant = {
  deviceName: 'Pixel 8',
  factors: { google: true, password: true },
  fingerprint: 'fp',
};

/**
 * Builds a well-formed stored record, as the store itself writes one.
 * @param overrides - Fields to replace.
 * @returns The record.
 */
function storedRecord(overrides: Partial<Record<keyof IAppTokenRecord, unknown>> = {}): object {
  return {
    id: 'AAAAAAAAAAAAAAAAAAAAAA',
    familyId: '0f0e0d0c-0b0a-4908-8706-050403020100',
    tokenHash: 'a'.repeat(64),
    deviceName: 'Pixel 8',
    factors: { google: true, password: true },
    fingerprint: 'fp',
    issuedAt: NOW,
    lastUsedAt: NOW,
    expiresAt: NOW + DAY_MS,
    ...overrides,
  };
}

/**
 * Serialises one stored record with a timestamp JSON parses as Infinity.
 * @param field - The timestamp to overflow.
 * @returns The file contents.
 */
function withNonFinite(field: 'issuedAt' | 'lastUsedAt' | 'expiresAt' | 'revokedAt'): string {
  const contents = JSON.stringify({ tokens: [storedRecord({ revokedAt: NOW })] });
  return contents.replace(new RegExp(`"${field}":\\d+`), `"${field}":1e999`);
}

/**
 * Builds a store over a fresh in-memory filesystem, optionally seeding the file.
 * @param contents - File contents to seed, or undefined for no file.
 * @param mode - Permission bits of the seeded file.
 * @returns The store under test and the filesystem behind it.
 */
function makeStore(
  contents?: string, mode = 0o600,
): { store: AppTokenStore; fileSystem: FakeFileSystem } {
  const fileSystem = new FakeFileSystem();
  if (contents !== undefined) fileSystem.seedFile(TOKENS_PATH, contents, mode);
  const store = new AppTokenStore(fileSystem, TOKENS_PATH);
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
function storedJson(fileSystem: FakeFileSystem): { tokens: IAppTokenRecord[] } {
  return JSON.parse(fileSystem.contentsOf(TOKENS_PATH)) as { tokens: IAppTokenRecord[] };
}

describe('AppTokenStore on the secure store', () => {
  it('writes a new file owner-only', () => {
    const { store, fileSystem } = makeStore();
    store.issue(GRANT, NOW);
    expect(fileSystem.modeOf(TOKENS_PATH)).toBe(0o600);
  });

  it('makes a world-readable file owner-only when it reads it', () => {
    const { store, fileSystem } = makeStore(JSON.stringify({ tokens: [storedRecord()] }), 0o644);
    store.list(NOW);
    expect(fileSystem.modeOf(TOKENS_PATH)).toBe(0o600);
  });

  it('writes the tokens as the only record', () => {
    const { store, fileSystem } = makeStore();
    const issued = store.issue(GRANT, NOW);
    expect(storedJson(fileSystem)).toEqual({ tokens: [issued.record] });
  });

  it('reads a list an older release wrote', () => {
    const { store } = makeStore(JSON.stringify([storedRecord()]));
    expect(store.list(NOW).map((record) => record.id)).toEqual(['AAAAAAAAAAAAAAAAAAAAAA']);
  });

  it('writes an older list back as the tokens record, without moving it aside', () => {
    const { store, fileSystem } = makeStore(JSON.stringify([storedRecord()]));
    store.issue(GRANT, NOW);
    expect(storedJson(fileSystem).tokens).toHaveLength(2);
    expect(quarantinedNames(fileSystem)).toEqual([]);
  });

  it.each([
    ['text that is not JSON', 'not-json'],
    ['a root that is neither a list nor an object', JSON.stringify('a')],
    ['no tokens record', JSON.stringify({})],
    ['a tokens record that is not a list', JSON.stringify({ tokens: 'a' })],
    ['a record besides the tokens', JSON.stringify({ tokens: [storedRecord()], extra: 1 })],
    ['an entry missing a field', JSON.stringify({ tokens: [{ id: 'x' }] })],
    ['an id that is not 22 base64url characters', JSON.stringify({ tokens: [storedRecord({ id: 'x' })] })],
    ['a family id that is not a UUID', JSON.stringify({ tokens: [storedRecord({ familyId: 'f' })] })],
    ['a token hash that is not 64 lowercase hex characters',
      JSON.stringify({ tokens: [storedRecord({ tokenHash: 'A'.repeat(64) })] })],
    ['an issuedAt that is not finite', withNonFinite('issuedAt')],
    ['a lastUsedAt that is not finite', withNonFinite('lastUsedAt')],
    ['an expiresAt that is not finite', withNonFinite('expiresAt')],
    ['a revokedAt that is not finite', withNonFinite('revokedAt')],
    ['two records sharing an id',
      JSON.stringify({ tokens: [storedRecord(), storedRecord({ tokenHash: 'b'.repeat(64) })] })],
    ['two records sharing a token hash',
      JSON.stringify({ tokens: [storedRecord(), storedRecord({ id: 'BBBBBBBBBBBBBBBBBBBBBB' })] })],
    ['an older list with a malformed entry', JSON.stringify([storedRecord(), 12])],
    ['an entry with a field the store does not write',
      JSON.stringify({ tokens: [{ ...storedRecord(), refreshToken: 'plain' }] })],
    ['factors with a field the store does not write',
      JSON.stringify({ tokens: [storedRecord({ factors: { google: true, password: true, admin: true } })] })],
    ['a top-level __proto__ key',
      `{"__proto__":{"refreshToken":"plain"},"tokens":[${JSON.stringify(storedRecord())}]}`],
  ])('moves aside a file holding %s on the next write', (_label, contents) => {
    const { store, fileSystem } = makeStore(contents);
    const issued = store.issue(GRANT, NOW);
    expect(quarantinedNames(fileSystem)).toHaveLength(1);
    expect(storedJson(fileSystem).tokens).toContainEqual(issued.record);
  });

  it('drops every record that shares an id with another, so none of them can be refreshed', () => {
    const clash = storedRecord({ tokenHash: 'b'.repeat(64) });
    const other = storedRecord({ id: 'CCCCCCCCCCCCCCCCCCCCCC', tokenHash: 'c'.repeat(64) });
    const { store } = makeStore(JSON.stringify({ tokens: [storedRecord(), clash, other] }));
    expect(store.list(NOW).map((record) => record.id)).toEqual(['CCCCCCCCCCCCCCCCCCCCCC']);
  });

  it.each([
    ['on the entry', { ...storedRecord(), refreshToken: 'PLAINTEXT-TOKEN' }],
    ['in its factors', storedRecord({ factors: { google: true, password: true, note: 'PLAINTEXT-TOKEN' } })],
    ['named like an inherited property', { ...storedRecord(), toString: 'PLAINTEXT-TOKEN' }],
  ])('drops an entry with a field the store does not write %s, and never writes it back', (_label, entry) => {
    const { store, fileSystem } = makeStore(JSON.stringify({ tokens: [entry] }));
    expect(store.list(NOW)).toEqual([]);
    store.issue(GRANT, NOW);
    expect(fileSystem.contentsOf(TOKENS_PATH)).not.toContain('PLAINTEXT-TOKEN');
  });

  it('keeps an entry holding the optional fields the store writes', () => {
    const entry = storedRecord({ email: 'a@example.com', revokedAt: NOW, expiresAt: NOW + DAY_MS });
    const { store, fileSystem } = makeStore(JSON.stringify({ tokens: [entry] }));
    store.issue(GRANT, NOW);
    expect(storedJson(fileSystem).tokens).toContainEqual(entry);
    expect(quarantinedNames(fileSystem)).toEqual([]);
  });

  it('drops every record that shares a token hash with another', () => {
    const clash = storedRecord({ id: 'BBBBBBBBBBBBBBBBBBBBBB' });
    const { store } = makeStore(JSON.stringify({ tokens: [storedRecord(), clash] }));
    expect(store.list(NOW)).toEqual([]);
  });

  it('drops expired records on the next write without moving the file aside', () => {
    const expired = storedRecord({ expiresAt: NOW - 1 });
    const { store, fileSystem } = makeStore(JSON.stringify({ tokens: [expired] }));
    const issued = store.issue(GRANT, NOW);
    expect(storedJson(fileSystem)).toEqual({ tokens: [issued.record] });
    expect(quarantinedNames(fileSystem)).toEqual([]);
  });

  it('keeps the records of a file that held a top-level __proto__ key', () => {
    const contents = `{"__proto__":{"refreshToken":"plain"},"tokens":[${JSON.stringify(storedRecord())}]}`;
    const { store, fileSystem } = makeStore(contents);
    store.issue(GRANT, NOW);
    expect(storedJson(fileSystem).tokens.map((record) => record.id)).toContain('AAAAAAAAAAAAAAAAAAAAAA');
  });

  it('overwrites an intact file without moving it aside', () => {
    const { store, fileSystem } = makeStore(JSON.stringify({ tokens: [storedRecord()] }));
    store.revokeFamily('0f0e0d0c-0b0a-4908-8706-050403020100', NOW);
    expect(storedJson(fileSystem).tokens[0]?.revokedAt).toBe(NOW);
    expect(quarantinedNames(fileSystem)).toEqual([]);
  });

  it('revokes a replayed family from the read that caught the replay', () => {
    const { store, fileSystem } = makeStore();
    const first = store.issue(GRANT, NOW);
    store.rotate(first.token, NOW + 1000);
    const readsSoFar = fileSystem.calls.filter((name) => name === 'openForRead').length;
    fileSystem.failOnCall('openForRead', readsSoFar + 2, 'EIO');
    const late = NOW + 1000 + ROTATION_OVERLAP_MS + 1;
    const replay = store.rotate(first.token, late);
    expect(replay).toMatchObject({ success: false, status: 'reused' });
    expect(store.list(late)).toEqual([]);
  });

  it('keeps the old file and throws when the new one cannot be staged', () => {
    const contents = JSON.stringify({ tokens: [storedRecord()] });
    const { store, fileSystem } = makeStore(contents);
    fileSystem.forcedFailures.set('createExclusive', 'ENOSPC');
    expect(() => store.issue(GRANT, NOW)).toThrow(/Could not save the app tokens/);
    expect(fileSystem.contentsOf(TOKENS_PATH)).toBe(contents);
  });

  it.each([
    ['issue', (store: AppTokenStore): unknown => store.issue(GRANT, NOW)],
    ['rotate', (store: AppTokenStore): unknown => store.rotate('any-token', NOW)],
    ['revoke', (store: AppTokenStore): unknown => store.revoke('AAAAAAAAAAAAAAAAAAAAAA', NOW)],
    ['revokeFamily', (store: AppTokenStore): unknown => store.revokeFamily('f', NOW)],
    ['revokeByToken', (store: AppTokenStore): unknown => store.revokeByToken('any-token', NOW)],
    ['prune', (store: AppTokenStore): unknown => { store.prune(NOW); return undefined; }],
  ])('%s throws without writing when it cannot read the file', (_label, act) => {
    const contents = JSON.stringify({ tokens: [storedRecord()] });
    const { store, fileSystem } = makeStore(contents);
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    expect(() => act(store)).toThrow(StorageError);
    expect(() => act(store)).toThrow(/Could not read the app tokens before saving/);
    expect(fileSystem.stagedPaths).toEqual([]);
    expect(fileSystem.contentsOf(TOKENS_PATH)).toBe(contents);
  });

  it('finds and lists nothing when the file cannot be read', () => {
    const { store, fileSystem } = makeStore(JSON.stringify({ tokens: [storedRecord()] }));
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    expect(store.list(NOW)).toEqual([]);
    expect(store.findByToken('any-token', NOW)).toBeUndefined();
  });

  it('sweeps a staged file an earlier run left behind', () => {
    const { store, fileSystem } = makeStore();
    const staged = seedStaleStaged(fileSystem, TOKENS_PATH);
    const swept = store.sweepStagedLeftovers();
    expect(swept.success && swept.data.removedCount).toBe(1);
    expect(fileSystem.hasEntry(staged)).toBe(false);
  });
});
