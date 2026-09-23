/**
 * Read-path behaviour of {@link BankTokenStore}.
 *
 * <p>Runs the adapter over the real {@link SecureJsonStore} and an in-memory
 * filesystem. The primitive's own guarantees are proved in `tests/storage`;
 * these cases prove what the adapter makes of each outcome — and above all
 * that a store it could not read is reported as a failure, not passed off as
 * "no token", which would hide the problem behind a routine cold login.
 */

import { describe, expect, it } from 'vitest';

import {
  CAPTURED_AT, fakeToken, makeStore, OWNER_ONLY, seedRaw, seedRecords, STORE_PATH,
  WORLD_READABLE,
} from './BankTokenStoreFixture.js';

describe('BankTokenStore read', () => {
  it('reads no token when the store has never been written', () => {
    const { store } = makeStore();
    expect(store.read('oneZero')).toMatchObject({ success: true, data: '' });
  });

  it('reads no token for an account the store holds no entry for', () => {
    const { store, fileSystem } = makeStore();
    seedRecords(fileSystem, { pepper: { token: fakeToken(), capturedAt: CAPTURED_AT } });
    expect(store.read('oneZero')).toMatchObject({ success: true, data: '' });
  });

  it('reads the stored token for an account that has one', () => {
    const { store, fileSystem } = makeStore();
    const token = fakeToken();
    seedRecords(fileSystem, { oneZero: { token, capturedAt: CAPTURED_AT } });
    expect(store.read('oneZero')).toMatchObject({ success: true, data: token });
  });

  it('reads no token from a store that is not valid JSON', () => {
    const { store, fileSystem } = makeStore();
    seedRaw(fileSystem, '{"oneZero": {"token": "trunc');
    expect(store.read('oneZero')).toMatchObject({ success: true, data: '' });
  });

  it('still reads a healthy account stored beside a malformed one', () => {
    const { store, fileSystem } = makeStore();
    const token = fakeToken();
    seedRecords(fileSystem, { pepper: null, oneZero: { token, capturedAt: CAPTURED_AT } });
    expect(store.read('oneZero')).toMatchObject({ success: true, data: token });
  });

  it('makes a world-readable store owner-only on a read alone', () => {
    const { store, fileSystem } = makeStore();
    seedRecords(fileSystem, { oneZero: { token: fakeToken(), capturedAt: CAPTURED_AT } }, WORLD_READABLE);
    store.read('oneZero');
    expect(fileSystem.modeOf(STORE_PATH)).toBe(OWNER_ONLY);
  });

  it('still returns the token of a store it had to make owner-only', () => {
    const { store, fileSystem } = makeStore();
    const token = fakeToken();
    seedRecords(fileSystem, { oneZero: { token, capturedAt: CAPTURED_AT } }, WORLD_READABLE);
    expect(store.read('oneZero')).toMatchObject({ success: true, data: token });
  });

  it('creates nothing when it reads a store that does not exist', () => {
    const { store, fileSystem } = makeStore();
    const before = fileSystem.names();
    store.read('oneZero');
    expect(fileSystem.names()).toEqual(before);
  });

  it('reports a store it could not close as a failure, not as no token', () => {
    const { store, fileSystem } = makeStore();
    seedRecords(fileSystem, { oneZero: { token: fakeToken(), capturedAt: CAPTURED_AT } });
    fileSystem.forcedFailures.set('close', 'EIO');
    expect(store.read('oneZero')).toMatchObject({ success: false, status: 'EIO' });
  });

  it('reports a store it is not allowed to open as a failure', () => {
    const { store, fileSystem } = makeStore();
    seedRecords(fileSystem, { oneZero: { token: fakeToken(), capturedAt: CAPTURED_AT } });
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    expect(store.read('oneZero')).toMatchObject({ success: false, status: 'EACCES' });
  });

  it('reports a hard-linked store as a failure rather than trusting it', () => {
    const { store, fileSystem } = makeStore();
    seedRecords(fileSystem, { oneZero: { token: fakeToken(), capturedAt: CAPTURED_AT } });
    fileSystem.seedHardLink(STORE_PATH, '/home/victim/notes.json');
    expect(store.read('oneZero')).toMatchObject({ success: false, status: 'EMLINK' });
  });

  it('never serves the file a symlink at the store path points at', () => {
    const { store, fileSystem } = makeStore();
    const planted = JSON.stringify({ oneZero: { token: fakeToken(), capturedAt: CAPTURED_AT } });
    fileSystem.seedFile('/tmp/planted.json', planted, OWNER_ONLY);
    fileSystem.seedSymlink(STORE_PATH, '/tmp/planted.json');
    expect(store.read('oneZero')).toMatchObject({ success: true, data: '' });
  });

  it('treats a bare bank id and a composite key as different accounts', () => {
    const { store, fileSystem } = makeStore();
    seedRecords(fileSystem, { 'oneZero:personal': { token: fakeToken(), capturedAt: CAPTURED_AT } });
    expect(store.read('oneZero')).toMatchObject({ success: true, data: '' });
  });
});
