/**
 * Remove-path behaviour of {@link BankTokenStore}.
 *
 * <p>A credential the bank has refused is worse than none: every run sends it,
 * fails, and never reaches the cold login that would mint a fresh one. Taking
 * one entry out is therefore a write like any other — it replaces the whole
 * file — so every case here is about what survives it: the other accounts,
 * their sealing, damaged evidence, and a store the adapter could not read.
 */

import { describe, expect, it } from 'vitest';

import { NO_RECORD } from '../../src/Scraper/Tokens/BankTokenRecords.js';
import tokenDigest from '../../src/Scraper/Tokens/TokenDigest.js';
import createTokenRecordCipher from '../../src/Scraper/Tokens/TokenRecordCipher.js';
import { TEST_ENCRYPTION_KEY } from '../helpers/testCredentials.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';
import {
  ACCOUNT_LOGIN, CAPTURED_AT, fakeToken, makeStore, quarantinedNames, seedRaw, seedRecords,
  STORE_PATH, storedRecords,
} from './BankTokenStoreFixture.js';

/** Key of the entry each case removes. */
const DEVICE_KEY = 'pepper-device:family';

/** Key of an account that must survive every removal. */
const SIBLING_KEY = 'oneZero:personal';

/**
 * Builds a record as the store writes one.
 * @param token - Token the record carries.
 * @returns A usable record bound to the account's login.
 */
function recordOf(token: string): Record<string, string> {
  return { token, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN };
}

/**
 * Seeds a plaintext store holding the entry to remove and one sibling.
 * @returns The store, its filesystem and the sibling as seeded.
 */
function seedPair(): ReturnType<typeof makeStore> & { sibling: Record<string, string> } {
  const arranged = makeStore();
  const sibling = recordOf(fakeToken());
  seedRecords(arranged.fileSystem, { [DEVICE_KEY]: recordOf(fakeToken()), [SIBLING_KEY]: sibling });
  return { ...arranged, sibling };
}

describe('BankTokenStore remove', () => {
  describe('an entry the file holds', () => {
    it('reports the file as replaced', () => {
      const { store } = seedPair();
      expect(store.remove(DEVICE_KEY)).toMatchObject({ success: true, data: { written: true } });
    });

    it('leaves nothing for a later read of that key', () => {
      const { store } = seedPair();
      store.remove(DEVICE_KEY);
      expect(store.read(DEVICE_KEY)).toMatchObject({ success: true, data: { record: NO_RECORD, isIntact: true } });
    });

    it('keeps every other entry exactly as it was', () => {
      const { store, fileSystem, sibling } = seedPair();
      store.remove(DEVICE_KEY);
      expect(storedRecords(fileSystem)).toEqual({ [SIBLING_KEY]: sibling });
    });

    it('leaves a well-formed empty store when it removes the last entry', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { [DEVICE_KEY]: recordOf(fakeToken()) });
      store.remove(DEVICE_KEY);
      expect({ stored: storedRecords(fileSystem), kept: quarantinedNames(fileSystem) })
        .toEqual({ stored: {}, kept: [] });
    });

    it('keeps the other entries sealed, and readable, under the config password', () => {
      const { store, fileSystem } = makeStore(new FakeFileSystem(), createTokenRecordCipher(TEST_ENCRYPTION_KEY));
      const [device, sibling] = [fakeToken(), fakeToken()];
      store.write(DEVICE_KEY, device, ACCOUNT_LOGIN);
      store.write(SIBLING_KEY, sibling, ACCOUNT_LOGIN);
      store.remove(DEVICE_KEY);
      const contents = fileSystem.contentsOf(STORE_PATH);
      expect({ keys: Object.keys(storedRecords(fileSystem)), leaked: contents.includes(sibling) })
        .toEqual({ keys: [SIBLING_KEY], leaked: false });
      expect(store.read(SIBLING_KEY)).toMatchObject({ success: true, data: { record: { token: sibling } } });
    });
  });

  describe('nothing to remove', () => {
    it('writes nothing when the file holds no entry under that key', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { [SIBLING_KEY]: recordOf(fakeToken()) });
      const seeded = fileSystem.contentsOf(STORE_PATH);
      const result = store.remove(DEVICE_KEY);
      expect({ result, left: fileSystem.contentsOf(STORE_PATH), staged: fileSystem.stagedPaths })
        .toMatchObject({ result: { success: true, data: { written: false } }, left: seeded, staged: [] });
    });

    it('creates no file when there is none', () => {
      const { store, fileSystem } = makeStore();
      const result = store.remove(DEVICE_KEY);
      expect({ result, exists: fileSystem.hasEntry(STORE_PATH) })
        .toMatchObject({ result: { success: true, data: { written: false } }, exists: false });
    });
  });

  describe('a damaged store', () => {
    it('sets the damage aside before removing the entry, keeping the usable siblings', () => {
      const { store, fileSystem } = makeStore();
      const sibling = recordOf(fakeToken());
      seedRecords(fileSystem, { payBox: null, [DEVICE_KEY]: recordOf(fakeToken()), [SIBLING_KEY]: sibling });
      store.remove(DEVICE_KEY);
      expect({ kept: quarantinedNames(fileSystem).length, stored: storedRecords(fileSystem) })
        .toEqual({ kept: 1, stored: { [SIBLING_KEY]: sibling } });
    });

    it('never replaces a store it is not allowed to open', () => {
      const { store, fileSystem } = seedPair();
      const seeded = fileSystem.contentsOf(STORE_PATH);
      fileSystem.forcedFailures.set('openForRead', 'EACCES');
      const result = store.remove(DEVICE_KEY);
      expect({ result, left: fileSystem.contentsOf(STORE_PATH), staged: fileSystem.stagedPaths })
        .toMatchObject({ result: { success: false, status: 'EACCES' }, left: seeded, staged: [] });
    });

    it('leaves an unparseable store in place when it cannot tell what to remove', () => {
      const { store, fileSystem } = makeStore();
      seedRaw(fileSystem, 'not json at all');
      const result = store.remove(DEVICE_KEY);
      expect({ result, left: fileSystem.contentsOf(STORE_PATH), kept: quarantinedNames(fileSystem) })
        .toMatchObject({ result: { success: true, data: { written: false } }, left: 'not json at all', kept: [] });
    });
  });

  describe('a commit that fails', () => {
    it('names the account it could not clear, but never a token', () => {
      const { store, fileSystem } = makeStore();
      const device = fakeToken();
      seedRecords(fileSystem, { [DEVICE_KEY]: recordOf(device) });
      fileSystem.forcedFailures.set('rename', 'EXDEV');
      const result = store.remove(DEVICE_KEY);
      expect(!result.success && result.message)
        .toMatch(/^Could not remove the long-term token for pepper-device:family: /);
      expect(JSON.stringify(result)).not.toContain(device);
    });

    it('leaves the entry readable when the replacement could not be published', () => {
      const { store, fileSystem } = makeStore();
      const device = fakeToken();
      seedRecords(fileSystem, { [DEVICE_KEY]: recordOf(device) });
      fileSystem.forcedFailures.set('rename', 'EXDEV');
      store.remove(DEVICE_KEY);
      expect(store.read(DEVICE_KEY)).toMatchObject({ success: true, data: { record: { token: device } } });
    });
  });
});

/**
 * A token that was not accepted is retired only if it is still the one stored.
 * By then another attempt may have minted a new token for the entry, and
 * deleting that one would cost an extra SMS for nothing.
 */
describe('BankTokenStore removeMatching', () => {
  it('retires the stored token it was asked about, keeping every other entry', () => {
    const { store, fileSystem, sibling } = seedPair();
    const device = fakeToken();
    store.write(DEVICE_KEY, device, ACCOUNT_LOGIN);
    const result = store.removeMatching(DEVICE_KEY, tokenDigest(device));
    expect(result).toMatchObject({ success: true, data: 'retired' });
    expect(storedRecords(fileSystem)).toEqual({ [SIBLING_KEY]: sibling });
  });

  it('keeps a token that changed since, and writes nothing', () => {
    const { store, fileSystem } = seedPair();
    const seeded = fileSystem.contentsOf(STORE_PATH);
    const result = store.removeMatching(DEVICE_KEY, tokenDigest(fakeToken()));
    expect({ result, left: fileSystem.contentsOf(STORE_PATH), staged: fileSystem.stagedPaths })
      .toMatchObject({ result: { success: true, data: 'changed' }, left: seeded, staged: [] });
  });

  it('reports an entry with no usable token as absent, and creates no file', () => {
    const { store, fileSystem } = makeStore();
    const result = store.removeMatching(DEVICE_KEY, tokenDigest(fakeToken()));
    expect({ result, exists: fileSystem.hasEntry(STORE_PATH) })
      .toMatchObject({ result: { success: true, data: 'absent' }, exists: false });
  });

  it('never replaces a store it is not allowed to open', () => {
    const { store, fileSystem } = seedPair();
    const seeded = fileSystem.contentsOf(STORE_PATH);
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    const result = store.removeMatching(DEVICE_KEY, tokenDigest(fakeToken()));
    expect({ result, left: fileSystem.contentsOf(STORE_PATH) })
      .toMatchObject({ result: { success: false, status: 'EACCES' }, left: seeded });
  });

  it('sets a damaged store aside before retiring, keeping the usable siblings', () => {
    const { store, fileSystem } = makeStore();
    const [device, sibling] = [fakeToken(), recordOf(fakeToken())];
    seedRecords(fileSystem, { payBox: null, [DEVICE_KEY]: recordOf(device), [SIBLING_KEY]: sibling });
    const result = store.removeMatching(DEVICE_KEY, tokenDigest(device));
    expect(result).toMatchObject({ success: true, data: 'retired' });
    expect({ kept: quarantinedNames(fileSystem).length, stored: storedRecords(fileSystem) })
      .toEqual({ kept: 1, stored: { [SIBLING_KEY]: sibling } });
  });

  it('names the account it could not retire, but never a token', () => {
    const { store, fileSystem } = makeStore();
    const device = fakeToken();
    seedRecords(fileSystem, { [DEVICE_KEY]: recordOf(device) });
    fileSystem.forcedFailures.set('rename', 'EXDEV');
    const result = store.removeMatching(DEVICE_KEY, tokenDigest(device));
    expect(!result.success && result.message)
      .toMatch(/^Could not remove the long-term token for pepper-device:family: /);
    expect(JSON.stringify(result)).not.toContain(device);
  });
});
