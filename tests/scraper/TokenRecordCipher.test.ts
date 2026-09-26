/**
 * Long-term bank tokens sealed at rest with the config password.
 *
 * <p>Pure: no filesystem. These tests prove what the store adapter relies on:
 * a sealed record opens only under the same password and the same store key,
 * anything else opens as {@link UNREADABLE_ENTRY} (which the adapter counts
 * as damage), and nothing about a token is readable from what gets written.
 */

import { createCipheriv, randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveKey, encryptBuffer } from '../../src/Config/ConfigEncryption.js';
import type { IBankTokenRecord } from '../../src/Scraper/Tokens/BankTokenRecords.js';
import createTokenRecordCipher, {
  PLAINTEXT_TOKEN_CIPHER, UNREADABLE_ENTRY,
} from '../../src/Scraper/Tokens/TokenRecordCipher.js';
import { fakeLoginFingerprint, fakeUuid } from '../helpers/factories.js';
import { TEST_ENCRYPTION_KEY } from '../helpers/testCredentials.js';

vi.mock('../../src/Config/ConfigEncryption.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/Config/ConfigEncryption.js')>();
  return {
    ...actual, deriveKey: vi.fn(actual.deriveKey), encryptBuffer: vi.fn(actual.encryptBuffer),
  };
});

/** Capture moment used where the exact value is asserted. */
const CAPTURED_AT = '2026-09-26T08:41:00.000Z';

/** Store keys as the importer builds them: `bankId:accountKey`. */
const ONE_ZERO = 'oneZero:personal';
const PEPPER = 'pepper:family';

/** The one message every failed write gives; it names nothing secret. */
const SEAL_FAILURE = 'the token file could not be sealed';

/** A sealed entry as it sits in the file. */
type Sealed = Record<string, unknown>;

/**
 * Builds a record the way a completed login would have captured it.
 * @returns A fresh token bound to a fresh login.
 */
function capturedRecord(): IBankTokenRecord {
  return { token: `lt-${fakeUuid()}`, capturedAt: CAPTURED_AT, login: fakeLoginFingerprint() };
}

/**
 * Seals a record set the way one write would, failing the test if it cannot.
 * @param records - Plaintext records by store key.
 * @param password - Password to seal under.
 * @returns The sealed entries by store key.
 */
function sealAll(
  records: Record<string, IBankTokenRecord>, password = TEST_ENCRYPTION_KEY,
): Record<string, Sealed> {
  const sealed = createTokenRecordCipher(password).sealRecords(records);
  if (!sealed.success) throw new Error(`sealing failed: ${sealed.message}`);
  return sealed.data as Record<string, Sealed>;
}

/**
 * Returns a copy of a sealed entry with the first byte of one base64 field flipped.
 * @param entry - Sealed entry to copy.
 * @param field - Base64 field to change.
 * @returns The changed copy.
 */
function withFlippedByte(entry: Sealed, field: string): Sealed {
  const bytes = Buffer.from(String(entry[field]), 'base64');
  bytes[0] ^= 0xff;
  return { ...entry, [field]: bytes.toString('base64') };
}

/**
 * Returns a copy of a sealed entry with one base64 field cut to its first 12 bytes.
 * @param entry - Sealed entry to copy.
 * @param field - Base64 field to shorten.
 * @returns The shortened copy.
 */
function withTwelveBytes(entry: Sealed, field: string): Sealed {
  const bytes = Buffer.from(String(entry[field]), 'base64');
  return { ...entry, [field]: bytes.subarray(0, 12).toString('base64') };
}

/**
 * Seals a record under the right password and store key, with an IV of any length.
 *
 * <p>AES-GCM accepts IVs other than 16 bytes, so the tag of this record is
 * authentic: only the schema can refuse it.
 * @param storeKey - Store key the record is sealed for.
 * @param record - Record to seal.
 * @param ivLength - Bytes of IV to seal with.
 * @returns The sealed entry.
 */
function sealedWithIvOf(storeKey: string, record: IBankTokenRecord, ivLength: number): Sealed {
  const salt = randomBytes(32);
  const initVector = randomBytes(ivLength);
  const key = deriveKey(TEST_ENCRYPTION_KEY, salt);
  const cipher = createCipheriv('aes-256-gcm', key, initVector, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(JSON.stringify(storeKey), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()]);
  return {
    encrypted: true, version: 1, salt: salt.toString('base64'),
    initVector: initVector.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

describe('TokenRecordCipher', () => {
  beforeEach(() => {
    vi.mocked(deriveKey).mockReset();
    vi.mocked(encryptBuffer).mockReset();
  });

  describe('with a password', () => {
    it('opens every record of an earlier write, under the same password', () => {
      const records = { [ONE_ZERO]: capturedRecord(), [PEPPER]: capturedRecord() };
      const sealed = sealAll(records);
      const opened = createTokenRecordCipher(TEST_ENCRYPTION_KEY).openRecords(sealed);
      expect(opened).toEqual(records);
    });

    it('writes no token, login or capture moment in readable form', () => {
      const record = capturedRecord();
      const written = JSON.stringify(sealAll({ [ONE_ZERO]: record }));
      const readable = [record.token, record.login, record.capturedAt].filter((value) =>
        written.includes(value));
      expect(readable).toEqual([]);
    });

    it('seals only the token, capture moment and login of a record', () => {
      const record = capturedRecord();
      const withExtra = { ...record, accountKey: 'personal' } as IBankTokenRecord;
      const sealed = sealAll({ [ONE_ZERO]: withExtra });
      const opened = createTokenRecordCipher(TEST_ENCRYPTION_KEY).openRecords(sealed);
      expect(opened[ONE_ZERO]).toStrictEqual(record);
    });

    it('seals every record of one write under one salt, each with its own IV', () => {
      const sealed = sealAll({ [ONE_ZERO]: capturedRecord(), [PEPPER]: capturedRecord() });
      const [first, second] = [sealed[ONE_ZERO], sealed[PEPPER]];
      expect({ sameSalt: first.salt === second.salt, sameIv: first.initVector === second.initVector })
        .toEqual({ sameSalt: true, sameIv: false });
    });

    it('uses a fresh salt for each write', () => {
      const record = capturedRecord();
      const [first, second] = [sealAll({ [ONE_ZERO]: record }), sealAll({ [ONE_ZERO]: record })];
      expect(first[ONE_ZERO].salt).not.toBe(second[ONE_ZERO].salt);
    });

    it('returns a record set and entries with no prototype, so no planted toJSON applies', () => {
      const sealed = sealAll({ [ONE_ZERO]: capturedRecord() });
      const prototypes = [Object.getPrototypeOf(sealed), Object.getPrototypeOf(sealed[ONE_ZERO])];
      expect(prototypes).toEqual([null, null]);
    });

    it('seals the record it was given, even with a toJSON planted on Object.prototype', () => {
      const record = capturedRecord();
      const prototype = Object.prototype as Record<string, unknown>;
      prototype.toJSON = (): unknown => ({ token: 'attacker-token', capturedAt: '', login: '' });
      let sealed: Record<string, Sealed>;
      try {
        sealed = sealAll({ [ONE_ZERO]: record });
      } finally {
        delete prototype.toJSON;
      }
      const opened = createTokenRecordCipher(TEST_ENCRYPTION_KEY).openRecords(sealed);
      expect(opened[ONE_ZERO]).toEqual(record);
    });

    it('opens nothing under another password', () => {
      const sealed = sealAll({ [ONE_ZERO]: capturedRecord() });
      const opened = createTokenRecordCipher('another-config-password').openRecords(sealed);
      expect(opened[ONE_ZERO]).toBe(UNREADABLE_ENTRY);
    });

    it.each(['ciphertext', 'tag', 'initVector'])('opens nothing when its %s was changed', (field) => {
      const sealed = sealAll({ [ONE_ZERO]: capturedRecord() });
      const changed = { [ONE_ZERO]: withFlippedByte(sealed[ONE_ZERO], field) };
      const opened = createTokenRecordCipher(TEST_ENCRYPTION_KEY).openRecords(changed);
      expect(opened[ONE_ZERO]).toBe(UNREADABLE_ENTRY);
    });

    it('opens nothing when the record was moved to another store key', () => {
      const sealed = sealAll({ [ONE_ZERO]: capturedRecord() });
      const moved = { [PEPPER]: sealed[ONE_ZERO] };
      const opened = createTokenRecordCipher(TEST_ENCRYPTION_KEY).openRecords(moved);
      expect(opened[PEPPER]).toBe(UNREADABLE_ENTRY);
    });

    it.each([12, 20])('opens nothing for an authentic record sealed under a %i-byte IV', (ivLength) => {
      const record = capturedRecord();
      const control = createTokenRecordCipher(TEST_ENCRYPTION_KEY)
        .openRecords({ [ONE_ZERO]: sealedWithIvOf(ONE_ZERO, record, 16) });
      const opened = createTokenRecordCipher(TEST_ENCRYPTION_KEY)
        .openRecords({ [ONE_ZERO]: sealedWithIvOf(ONE_ZERO, record, ivLength) });
      expect(control[ONE_ZERO]).toEqual(record);
      expect(opened[ONE_ZERO]).toBe(UNREADABLE_ENTRY);
    });

    it('keeps apart two store keys that differ only in a lone surrogate', () => {
      const sealed = sealAll({ 'oneZero:\uD800': capturedRecord() });
      const moved = { 'oneZero:\uD801': sealed['oneZero:\uD800'] };
      const opened = createTokenRecordCipher(TEST_ENCRYPTION_KEY).openRecords(moved);
      expect(opened['oneZero:\uD801']).toBe(UNREADABLE_ENTRY);
    });

    it.each<[string, (entry: Sealed) => unknown]>([
      ['a version other than 1', (entry) => ({ ...entry, version: 2 })],
      ['no tag', ({ tag: _tag, ...rest }) => rest],
      ['a salt that is not text', (entry) => ({ ...entry, salt: 42 })],
      ['a 31-byte salt', (entry) => ({ ...entry, salt: Buffer.alloc(31, 7).toString('base64') })],
      ['an IV cut to 12 bytes', (entry) => withTwelveBytes(entry, 'initVector')],
      ['a tag cut to 12 bytes', (entry) => withTwelveBytes(entry, 'tag')],
      ['encrypted as the text "true"', (entry) => ({ ...entry, encrypted: 'true' })],
      ['its fields inherited rather than its own', (entry) => Object.create(entry)],
      ['no fields at all, only text', () => 'lt-plaintext-token'],
      ['null', () => null],
      ['an array', (entry) => [entry]],
    ])('opens nothing, and derives no key, for an entry with %s', (_shape, reshape) => {
      const sealed = sealAll({ [ONE_ZERO]: capturedRecord() });
      const reshaped = { [ONE_ZERO]: reshape(sealed[ONE_ZERO]) };
      vi.mocked(deriveKey).mockClear();
      const opened = createTokenRecordCipher(TEST_ENCRYPTION_KEY).openRecords(reshaped);
      expect(opened[ONE_ZERO]).toBe(UNREADABLE_ENTRY);
      expect(deriveKey).not.toHaveBeenCalled();
    });

    it('opens nothing for a plaintext record, so a planted token is never sent', () => {
      const opened = createTokenRecordCipher(TEST_ENCRYPTION_KEY).openRecords({
        [ONE_ZERO]: capturedRecord(),
      });
      expect(opened[ONE_ZERO]).toBe(UNREADABLE_ENTRY);
    });

    it.each<[string, (other: Sealed) => Sealed]>([
      ['a 31-byte salt', (other) => ({ ...other, salt: Buffer.alloc(31, 7).toString('base64') })],
      ['a tag cut to 12 bytes', (other) => withTwelveBytes(other, 'tag')],
    ])('takes the salt from the first well-formed record, not one with %s before it', (_shape, malform) => {
      const record = capturedRecord();
      const good = sealAll({ [PEPPER]: record })[PEPPER];
      const other = sealAll({ [ONE_ZERO]: capturedRecord() })[ONE_ZERO];
      vi.mocked(deriveKey).mockClear();
      const opened = createTokenRecordCipher(TEST_ENCRYPTION_KEY).openRecords({
        [ONE_ZERO]: malform(other), [PEPPER]: good,
      });
      const goodSalt = Buffer.from(String(good.salt), 'base64');
      expect(opened[PEPPER]).toEqual(record);
      expect(vi.mocked(deriveKey).mock.calls).toEqual([[TEST_ENCRYPTION_KEY, goodSalt]]);
    });

    it('opens nothing for a record sealed under a second salt', () => {
      const first = sealAll({ [ONE_ZERO]: capturedRecord() });
      const second = sealAll({ [PEPPER]: capturedRecord() });
      const mixed = { ...first, ...second };
      const opened = createTokenRecordCipher(TEST_ENCRYPTION_KEY).openRecords(mixed);
      expect(opened[PEPPER]).toBe(UNREADABLE_ENTRY);
    });

    it('derives one key to open a file, however many salts its records hold', () => {
      const mixed = {
        ...sealAll({ [ONE_ZERO]: capturedRecord() }),
        ...sealAll({ [PEPPER]: capturedRecord() }),
        ...sealAll({ 'payBox:main': capturedRecord() }),
      };
      vi.mocked(deriveKey).mockClear();
      createTokenRecordCipher(TEST_ENCRYPTION_KEY).openRecords(mixed);
      expect(deriveKey).toHaveBeenCalledTimes(1);
    });

    it('derives one key for a write, however many records it seals', () => {
      sealAll({ [ONE_ZERO]: capturedRecord(), [PEPPER]: capturedRecord(), 'payBox:main': capturedRecord() });
      expect(deriveKey).toHaveBeenCalledTimes(1);
    });

    it('returns the fixed failure, and does not throw, when the write key cannot be derived', () => {
      const record = capturedRecord();
      vi.mocked(deriveKey).mockImplementationOnce(() => {
        throw new Error(`pbkdf2 refused ${TEST_ENCRYPTION_KEY} for ${record.login}`);
      });
      const sealed = createTokenRecordCipher(TEST_ENCRYPTION_KEY).sealRecords({ [ONE_ZERO]: record });
      expect(sealed).toMatchObject({ success: false, message: SEAL_FAILURE });
    });

    it('returns the fixed failure, and does not throw, when a record cannot be sealed', () => {
      const record = capturedRecord();
      vi.mocked(encryptBuffer).mockImplementationOnce(() => {
        throw new Error(`cipher refused ${record.token} for ${record.login}`);
      });
      const sealed = createTokenRecordCipher(TEST_ENCRYPTION_KEY).sealRecords({ [ONE_ZERO]: record });
      expect(sealed).toMatchObject({ success: false, message: SEAL_FAILURE });
    });

    it('opens nothing, and does not throw, when the key cannot be derived', () => {
      const sealed = sealAll({ [ONE_ZERO]: capturedRecord() });
      vi.mocked(deriveKey).mockImplementationOnce(() => {
        throw new Error('pbkdf2 unavailable');
      });
      const opened = createTokenRecordCipher(TEST_ENCRYPTION_KEY).openRecords(sealed);
      expect(opened[ONE_ZERO]).toBe(UNREADABLE_ENTRY);
    });
  });

  describe('without a password', () => {
    it('is the plaintext cipher', () => {
      expect(createTokenRecordCipher('')).toBe(PLAINTEXT_TOKEN_CIPHER);
    });

    it('opens the records as they are', () => {
      const records = { [ONE_ZERO]: capturedRecord() };
      expect(PLAINTEXT_TOKEN_CIPHER.openRecords(records)).toBe(records);
    });

    it('seals the records as they are, so the file stays byte for byte the same', () => {
      const records = { [ONE_ZERO]: capturedRecord() };
      expect(PLAINTEXT_TOKEN_CIPHER.sealRecords(records)).toMatchObject({ success: true, data: records });
    });
  });
});
