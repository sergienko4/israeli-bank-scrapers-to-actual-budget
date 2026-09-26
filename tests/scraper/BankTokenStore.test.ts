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

import type { ITokenView } from '../../src/Scraper/Tokens/BankTokenStore.js';
import { fakeLoginFingerprint } from '../helpers/factories.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';
import {
  ACCOUNT_LOGIN, CAPTURED_AT, fakeToken, makeStore, OWNER_ONLY, seedRaw, seedRecords, STORE_PATH,
  WORLD_READABLE,
} from './BankTokenStoreFixture.js';

/**
 * Reads one key's view, failing the case when the store is unreadable.
 * @param store - Store under test.
 * @param storeKey - Key to read.
 * @returns The view the read returned.
 */
function viewOf(store: ReturnType<typeof makeStore>['store'], storeKey: string): ITokenView {
  const read = store.read(storeKey);
  if (!read.success) throw new Error(`unreadable store: ${read.message}`);
  return read.data;
}

describe('BankTokenStore read', () => {
  it('reads no token when the store has never been written', () => {
    const { store } = makeStore();
    expect(store.read('oneZero')).toMatchObject({ success: true, data: { record: { token: '' } } });
  });

  it('reads no token for an account the store holds no entry for', () => {
    const { store, fileSystem } = makeStore();
    seedRecords(fileSystem, { pepper: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
    expect(store.read('oneZero')).toMatchObject({ success: true, data: { record: { token: '' } } });
  });

  it('reads the stored token for an account that has one', () => {
    const { store, fileSystem } = makeStore();
    const token = fakeToken();
    seedRecords(fileSystem, { oneZero: { token, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
    expect(store.read('oneZero')).toMatchObject({ success: true, data: { record: { token: token } } });
  });

  it('reads no token from a store that is not valid JSON', () => {
    const { store, fileSystem } = makeStore();
    seedRaw(fileSystem, '{"oneZero": {"token": "trunc');
    expect(store.read('oneZero')).toMatchObject({ success: true, data: { record: { token: '' } } });
  });

  it('still reads a healthy account stored beside a malformed one', () => {
    const { store, fileSystem } = makeStore();
    const token = fakeToken();
    seedRecords(fileSystem, { pepper: null, oneZero: { token, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
    expect(store.read('oneZero')).toMatchObject({ success: true, data: { record: { token: token } } });
  });

  it('makes a world-readable store owner-only on a read alone', () => {
    const { store, fileSystem } = makeStore();
    seedRecords(fileSystem, { oneZero: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } }, WORLD_READABLE);
    store.read('oneZero');
    expect(fileSystem.modeOf(STORE_PATH)).toBe(OWNER_ONLY);
  });

  it('still returns the token of a store it had to make owner-only', () => {
    const { store, fileSystem } = makeStore();
    const token = fakeToken();
    seedRecords(fileSystem, { oneZero: { token, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } }, WORLD_READABLE);
    expect(store.read('oneZero')).toMatchObject({ success: true, data: { record: { token: token } } });
  });

  it.each([
    ['not valid JSON', (fs: FakeFileSystem): void => { seedRaw(fs, '{"oneZero": {"token": "trunc'); }],
    ['written before tokens were bound', (fs: FakeFileSystem): void => {
      seedRecords(fs, { oneZero: { token: fakeToken(), capturedAt: CAPTURED_AT } });
    }],
    ['binding one token to two logins', (fs: FakeFileSystem): void => {
      const token = fakeToken();
      seedRecords(fs, {
        'oneZero:a': { token, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN },
        'oneZero:b': { token, capturedAt: CAPTURED_AT, login: fakeLoginFingerprint() },
      });
    }],
  ])('leaves a store %s exactly where it was, since only a write sets damage aside', (_label: string, seed: (fs: FakeFileSystem) => void) => {
    const { store, fileSystem } = makeStore();
    seed(fileSystem);
    const before = { names: fileSystem.names(), contents: fileSystem.contentsOf(STORE_PATH) };
    store.read('oneZero:a');
    expect({ names: fileSystem.names(), contents: fileSystem.contentsOf(STORE_PATH) }).toEqual(before);
  });

  it('creates nothing when it reads a store that does not exist', () => {
    const { store, fileSystem } = makeStore();
    const before = fileSystem.names();
    store.read('oneZero');
    expect(fileSystem.names()).toEqual(before);
  });

  it('reports a store it could not close as a failure, not as no token', () => {
    const { store, fileSystem } = makeStore();
    seedRecords(fileSystem, { oneZero: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
    fileSystem.forcedFailures.set('close', 'EIO');
    expect(store.read('oneZero')).toMatchObject({ success: false, status: 'EIO' });
  });

  it('reports a store it is not allowed to open as a failure', () => {
    const { store, fileSystem } = makeStore();
    seedRecords(fileSystem, { oneZero: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    expect(store.read('oneZero')).toMatchObject({ success: false, status: 'EACCES' });
  });

  it('reports a hard-linked store as a failure rather than trusting it', () => {
    const { store, fileSystem } = makeStore();
    seedRecords(fileSystem, { oneZero: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
    fileSystem.seedHardLink(STORE_PATH, '/home/victim/notes.json');
    expect(store.read('oneZero')).toMatchObject({ success: false, status: 'EMLINK' });
  });

  it('never serves the file a symlink at the store path points at', () => {
    const { store, fileSystem } = makeStore();
    const planted = JSON.stringify({ oneZero: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
    fileSystem.seedFile('/tmp/planted.json', planted, OWNER_ONLY);
    fileSystem.seedSymlink(STORE_PATH, '/tmp/planted.json');
    expect(store.read('oneZero')).toMatchObject({ success: true, data: { record: { token: '' } } });
  });

  describe('the view', () => {
    it('returns the record with the login its token is bound to', () => {
      const { store, fileSystem } = makeStore();
      const record = { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN };
      seedRecords(fileSystem, { oneZero: record });
      expect(viewOf(store, 'oneZero').record).toEqual(record);
    });

    it('returns the empty record for a key with no entry', () => {
      const { store } = makeStore();
      expect(viewOf(store, 'oneZero').record).toEqual({ token: '', capturedAt: '', login: '' });
    });

    it.each([
      ['has never been written', undefined],
      ['holds only bound tokens', { pepper: { token: 'lt-a', capturedAt: CAPTURED_AT, login: 'a'.repeat(64) } }],
    ])('reads a store that %s as intact', (_label: string, records: Record<string, unknown> | undefined) => {
      const { store, fileSystem } = makeStore();
      if (records !== undefined) seedRecords(fileSystem, records);
      expect(viewOf(store, 'oneZero').isIntact).toBe(true);
    });

    it.each([
      ['is not valid JSON', '{"oneZero": {"token": "trunc'],
      ['was written before tokens were bound', JSON.stringify({ pepper: { token: 'lt-a', capturedAt: CAPTURED_AT } })],
      ['binds one token to two logins', JSON.stringify({
        'pepper:a': { token: 'lt-a', capturedAt: CAPTURED_AT, login: 'a'.repeat(64) },
        'pepper:b': { token: 'lt-a', capturedAt: CAPTURED_AT, login: 'b'.repeat(64) },
      })],
    ])('reads a store that %s as not intact', (_label: string, contents: string) => {
      const { store, fileSystem } = makeStore();
      seedRaw(fileSystem, contents);
      expect(viewOf(store, 'oneZero').isIntact).toBe(false);
    });

    it('names the login a token is bound to under any key', () => {
      const { store, fileSystem } = makeStore();
      const [token, login] = [fakeToken(), fakeLoginFingerprint()];
      seedRecords(fileSystem, { 'pepper:other': { token, capturedAt: CAPTURED_AT, login } });
      expect(viewOf(store, 'oneZero').loginOf(token)).toBe(login);
    });

    it('matches a token asked about with stray whitespace, as a hand-pasted seed has', () => {
      const { store, fileSystem } = makeStore();
      const token = fakeToken();
      seedRecords(fileSystem, { pepper: { token, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
      expect(viewOf(store, 'oneZero').loginOf(` ${token}\n`)).toBe(ACCOUNT_LOGIN);
    });

    it('names no login for a token the file does not hold', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { pepper: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
      expect(viewOf(store, 'oneZero').loginOf(fakeToken())).toBe('');
    });

    it('never carries the tokens of other accounts', () => {
      const { store, fileSystem } = makeStore();
      const other = fakeToken();
      seedRecords(fileSystem, {
        oneZero: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN },
        pepper: { token: other, capturedAt: CAPTURED_AT, login: fakeLoginFingerprint() },
      });
      expect(JSON.stringify(viewOf(store, 'oneZero'))).not.toContain(other);
    });
  });

  it('reads no token for an entry written before tokens were bound', () => {
    const { store, fileSystem } = makeStore();
    seedRecords(fileSystem, { oneZero: { token: fakeToken(), capturedAt: CAPTURED_AT } });
    expect(viewOf(store, 'oneZero').record.token).toBe('');
  });

  it('treats a bare bank id and a composite key as different accounts', () => {
    const { store, fileSystem } = makeStore();
    seedRecords(fileSystem, { 'oneZero:personal': { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
    expect(store.read('oneZero')).toMatchObject({ success: true, data: { record: { token: '' } } });
  });
});
