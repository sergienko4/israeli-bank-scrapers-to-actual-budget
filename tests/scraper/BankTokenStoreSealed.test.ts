/**
 * {@link BankTokenStore} with the config password: each record sealed at rest.
 *
 * <p>A long-term token skips the bank's SMS, so a copied token file must not
 * hand it over. With a password set, the store seals every record it writes
 * and opens every record it reads. A record that does not open costs that
 * account one SMS and marks the file not intact, exactly as damage does
 * today, so a changed password heals on the next login instead of failing.
 */

import { describe, expect, it } from 'vitest';

import redactSecrets from '../../src/Logger/SecretRedaction.js';
import type { IBankTokenRecord } from '../../src/Scraper/Tokens/BankTokenRecords.js';
import { NO_RECORD } from '../../src/Scraper/Tokens/BankTokenRecords.js';
import type BankTokenStore from '../../src/Scraper/Tokens/BankTokenStore.js';
import type { ITokenView } from '../../src/Scraper/Tokens/BankTokenStore.js';
import createTokenRecordCipher, {
  type ITokenRecordCipher, PLAINTEXT_TOKEN_CIPHER,
} from '../../src/Scraper/Tokens/TokenRecordCipher.js';
import { fail } from '../../src/Types/ProcedureHelpers.js';
import { fakeLoginFingerprint } from '../helpers/factories.js';
import { TEST_ENCRYPTION_KEY } from '../helpers/testCredentials.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';
import {
  ACCOUNT_LOGIN, CAPTURED_AT, fakeToken, makeStore, quarantinedNames, seedRecords, STORE_PATH,
  storedRecords,
} from './BankTokenStoreFixture.js';

/** Store keys as the importer builds them: `bankId:accountKey`. */
const ONE_ZERO = 'oneZero:personal';
const PEPPER = 'pepper:family';

/** The config password after the operator changed it. */
const CHANGED_PASSWORD = `${TEST_ENCRYPTION_KEY}-changed`;

/** An ISO capture moment, as the store stamps one on every write. */
const ISO_MOMENT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Builds the cipher a run with the config password gets.
 * @param password - Config password.
 * @returns A cipher that seals under it.
 */
function sealingCipher(password = TEST_ENCRYPTION_KEY): ITokenRecordCipher {
  return createTokenRecordCipher(password);
}

/**
 * Reads one account's view, failing the case if the store is unreadable.
 * @param store - Store to read.
 * @param storeKey - Account to read.
 * @returns What the file says about that account.
 */
function viewOf(store: BankTokenStore, storeKey: string): ITokenView {
  const view = store.read(storeKey);
  if (!view.success) throw new Error(`read failed: ${view.message}`);
  return view.data;
}

/**
 * Leaves a file behind whose records were sealed by an earlier run, not by this store.
 * @param fileSystem - Filesystem to seed.
 * @param records - Plaintext records by store key.
 * @returns Nothing.
 */
function seedSealed(fileSystem: FakeFileSystem, records: Record<string, IBankTokenRecord>): void {
  const sealed = sealingCipher().sealRecords(records);
  if (!sealed.success) throw new Error(`sealing failed: ${sealed.message}`);
  seedRecords(fileSystem, { ...sealed.data });
}

/**
 * Returns a copy of a sealed entry with the first byte of its ciphertext flipped.
 * @param entry - Sealed entry as stored.
 * @returns The changed copy.
 */
function withChangedCiphertext(entry: unknown): Record<string, unknown> {
  const fields = entry as Record<string, unknown>;
  const bytes = Buffer.from(String(fields.ciphertext), 'base64');
  bytes[0] ^= 0xff;
  return { ...fields, ciphertext: bytes.toString('base64') };
}

describe('BankTokenStore with the config password', () => {
  it('writes no token, login or capture moment to the file', () => {
    const { store, fileSystem } = makeStore(new FakeFileSystem(), sealingCipher());
    const token = fakeToken();
    store.write(ONE_ZERO, token, ACCOUNT_LOGIN);
    const raw = fileSystem.contentsOf(STORE_PATH);
    expect({
      readable: [token, ACCOUNT_LOGIN].filter((value) => raw.includes(value)),
      hasMoment: ISO_MOMENT.test(raw),
      entry: storedRecords(fileSystem)[ONE_ZERO],
    }).toMatchObject({ readable: [], hasMoment: false, entry: { encrypted: true, version: 1 } });
  });

  it('reads back, in a later run, the token it sealed', () => {
    const { store, fileSystem } = makeStore(new FakeFileSystem(), sealingCipher());
    const token = fakeToken();
    store.write(ONE_ZERO, token, ACCOUNT_LOGIN);
    const { store: later } = makeStore(fileSystem, sealingCipher());
    expect(viewOf(later, ONE_ZERO)).toMatchObject({
      record: { token, login: ACCOUNT_LOGIN }, isIntact: true,
    });
  });

  it('reads no token under another password, and says the file is not intact', () => {
    const { store, fileSystem } = makeStore(new FakeFileSystem(), sealingCipher());
    store.write(ONE_ZERO, fakeToken(), ACCOUNT_LOGIN);
    const { store: changed } = makeStore(fileSystem, sealingCipher(CHANGED_PASSWORD));
    expect(viewOf(changed, ONE_ZERO)).toMatchObject({ record: NO_RECORD, isIntact: false });
  });

  it('sets the old file aside on the first write after the password changes, then reads the new token', () => {
    const { store, fileSystem } = makeStore(new FakeFileSystem(), sealingCipher());
    store.write(ONE_ZERO, fakeToken(), ACCOUNT_LOGIN);
    const { store: changed } = makeStore(fileSystem, sealingCipher(CHANGED_PASSWORD));
    const fresh = fakeToken();
    changed.write(ONE_ZERO, fresh, ACCOUNT_LOGIN);
    expect(quarantinedNames(fileSystem)).toHaveLength(1);
    expect(viewOf(changed, ONE_ZERO)).toMatchObject({ record: { token: fresh }, isIntact: true });
  });

  it('costs only the changed account when one sealed record is edited', () => {
    const { store, fileSystem } = makeStore(new FakeFileSystem(), sealingCipher());
    const pepperToken = fakeToken();
    store.write(ONE_ZERO, fakeToken(), ACCOUNT_LOGIN);
    store.write(PEPPER, pepperToken, ACCOUNT_LOGIN);
    const records = storedRecords(fileSystem);
    seedRecords(fileSystem, { ...records, [ONE_ZERO]: withChangedCiphertext(records[ONE_ZERO]) });
    expect([viewOf(store, ONE_ZERO).record, viewOf(store, PEPPER).record.token])
      .toEqual([NO_RECORD, pepperToken]);
  });

  it('reads no token from a sealed record moved to another account', () => {
    const { store, fileSystem } = makeStore(new FakeFileSystem(), sealingCipher());
    store.write(ONE_ZERO, fakeToken(), ACCOUNT_LOGIN);
    const records = storedRecords(fileSystem);
    seedRecords(fileSystem, { [PEPPER]: records[ONE_ZERO] });
    expect(viewOf(store, PEPPER)).toMatchObject({ record: NO_RECORD, isIntact: false });
  });

  it('never reads a plaintext token under a password, so a planted one is never sent', () => {
    const { store, fileSystem } = makeStore(new FakeFileSystem(), sealingCipher());
    seedRecords(fileSystem, {
      [PEPPER]: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN },
    });
    expect(viewOf(store, PEPPER)).toMatchObject({ record: NO_RECORD, isIntact: false });
  });

  it('reads no token from a sealed file when no password is set', () => {
    const { store, fileSystem } = makeStore(new FakeFileSystem(), sealingCipher());
    store.write(ONE_ZERO, fakeToken(), ACCOUNT_LOGIN);
    const { store: plain } = makeStore(fileSystem);
    expect(viewOf(plain, ONE_ZERO)).toMatchObject({ record: NO_RECORD, isIntact: false });
  });

  it('refuses to rebind a token that two sealed records bind to two logins', () => {
    const { store, fileSystem } = makeStore(new FakeFileSystem(), sealingCipher());
    const token = fakeToken();
    seedSealed(fileSystem, {
      [ONE_ZERO]: { token, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN },
      [PEPPER]: { token, capturedAt: CAPTURED_AT, login: fakeLoginFingerprint() },
    });
    const result = store.write(ONE_ZERO, token, ACCOUNT_LOGIN);
    expect(viewOf(store, ONE_ZERO).record).toBe(NO_RECORD);
    expect(result).toMatchObject({ success: false, message: expect.stringContaining('another login') });
  });

  it('reads a blank sealed token as no token, and its sibling as usual', () => {
    const { store, fileSystem } = makeStore(new FakeFileSystem(), sealingCipher());
    const pepperToken = fakeToken();
    seedSealed(fileSystem, {
      [ONE_ZERO]: { token: '  ', capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN },
      [PEPPER]: { token: pepperToken, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN },
    });
    expect([viewOf(store, ONE_ZERO).record, viewOf(store, PEPPER).record.token])
      .toEqual([NO_RECORD, pepperToken]);
  });

  it('fails the write, and leaves the file as it was, when the records cannot be sealed', () => {
    const refusing: ITokenRecordCipher = {
      openRecords: PLAINTEXT_TOKEN_CIPHER.openRecords,
      sealRecords: () => fail('the token file could not be sealed'),
    };
    const { store, fileSystem } = makeStore(new FakeFileSystem(), refusing);
    seedRecords(fileSystem, {
      [PEPPER]: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN },
    });
    const before = fileSystem.contentsOf(STORE_PATH);
    const token = fakeToken();
    const result = store.write(ONE_ZERO, token, ACCOUNT_LOGIN);
    expect(result).toMatchObject({
      success: false,
      message: `Could not store the long-term token for ${ONE_ZERO}: the token file could not be sealed`,
    });
    expect({ after: fileSystem.contentsOf(STORE_PATH), staged: fileSystem.stagedPaths })
      .toEqual({ after: before, staged: [] });
  });

  it('hides a token that only a sealed record holds, once the store is read', () => {
    const { store, fileSystem } = makeStore(new FakeFileSystem(), sealingCipher());
    const token = fakeToken();
    seedSealed(fileSystem, { [ONE_ZERO]: { token, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
    store.read(PEPPER);
    expect(redactSecrets(`the bank quoted ${token} back`)).not.toContain(token);
  });
});
