/**
 * Seals long-term bank tokens at rest under the config password.
 *
 * <p>Each record is sealed on its own, so one damaged record costs one
 * account an SMS rather than every account. A write seals every record under
 * one fresh salt, and a read derives one key, for the salt of the file's first
 * sealed record: a hand-edited file holding many salts still costs a read one
 * derivation (about 75 ms). The store key is authenticated with each record,
 * so a record moved to another entry does not open.
 *
 * <p>An entry that does not open becomes {@link UNREADABLE_ENTRY}, which the
 * store counts as damage: the account logs in with an SMS, and the file is
 * quarantined before the next write. A plaintext entry under a password is
 * refused the same way, so a token planted in the file is never sent.
 */

import { randomBytes } from 'node:crypto';

import {
  AUTH_TAG_LENGTH, buildEncryptedPayload, decryptBuffer, deriveKey, encryptBuffer,
  type IEncryptedConfig, IV_LENGTH, SALT_LENGTH,
} from '../../Config/ConfigEncryption.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/ProcedureHelpers.js';
import type { IBankTokenRecord } from './BankTokenRecords.js';

/** Entries by store key, as the file holds them. */
export type StoreRecords = Readonly<Record<string, unknown>>;

/** Opens and seals a store's whole record set, binding each entry to its store key. */
export interface ITokenRecordCipher {
  /** Returns every entry opened; one that does not open is {@link UNREADABLE_ENTRY}. */
  openRecords: (records: StoreRecords) => StoreRecords;
  /** Returns the entries to write for one write, or why they could not be sealed. */
  sealRecords: (records: Readonly<Record<string, IBankTokenRecord>>) => Procedure<StoreRecords>;
}

/** A key derived from the password, and the salt it was derived with. */
interface IDerivedKey {
  readonly salt: Buffer;
  readonly key: Buffer;
}

/** The only sealed-record format this cipher opens. */
const SEALED_VERSION = 1;

/** Fields of a sealed record that hold base64 text. */
const SEALED_TEXT_FIELDS = ['salt', 'initVector', 'tag', 'ciphertext'] as const;

/** The exact decoded size of each fixed-size field of a sealed record. */
const SEALED_FIELD_BYTES = [
  ['salt', SALT_LENGTH], ['initVector', IV_LENGTH], ['tag', AUTH_TAG_LENGTH],
] as const;

const EMPTY_ENTRY = Object.create(null) as Record<string, never>;

/** What an entry becomes when it does not open; it holds no token. */
export const UNREADABLE_ENTRY: Readonly<Record<string, never>> = Object.freeze(EMPTY_ENTRY);

const NO_SEALED_RECORD = fail('the token file holds no sealed record');
const KEY_UNAVAILABLE = fail('the token key could not be derived');
const SEAL_FAILED = fail('the token file could not be sealed');

/**
 * Reads one own data property, never an inherited one or a getter.
 * @param fields - Entry already known to be an object.
 * @param name - Field to read.
 * @returns The own value; absent fields read as undefined.
 */
function ownField(fields: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(fields, name);
  return descriptor?.value;
}

/**
 * Tells whether an entry has the exact shape of a sealed record.
 *
 * <p>The sizes are checked here because the first sealed record picks the key
 * for the whole file; a malformed one must not pick it. AES-GCM accepts IVs of
 * other sizes, so only this check refuses one.
 * @param entry - Entry as read from the file.
 * @returns True for a version-1 sealed record whose salt, IV and tag have exact sizes.
 */
function isSealedEntry(entry: unknown): entry is IEncryptedConfig {
  if (typeof entry !== 'object' || entry === null) return false;
  if (ownField(entry, 'encrypted') !== true) return false;
  if (ownField(entry, 'version') !== SEALED_VERSION) return false;
  const isText = SEALED_TEXT_FIELDS.every((name) => typeof ownField(entry, name) === 'string');
  return isText && hasExactSizes(entry as IEncryptedConfig);
}

/**
 * Tells whether a sealed record's salt, IV and tag decode to their exact sizes.
 * @param entry - Entry whose fields are all text.
 * @returns True when every fixed-size field has its exact size.
 */
function hasExactSizes(entry: IEncryptedConfig): boolean {
  return SEALED_FIELD_BYTES.every(
    ([name, size]) => Buffer.from(entry[name], 'base64').length === size,
  );
}

/**
 * Decodes a sealed record's salt.
 * @param entry - Sealed record.
 * @returns The salt bytes.
 */
function saltOf(entry: IEncryptedConfig): Buffer {
  return Buffer.from(entry.salt, 'base64');
}

/**
 * Encodes a store key as authenticated data, one to one.
 *
 * <p>Plain UTF-8 turns every lone surrogate into the same replacement
 * character, so two distinct keys could authenticate each other's records.
 * `JSON.stringify` escapes lone surrogates, so distinct keys stay distinct.
 * @param storeKey - Store key the record belongs to.
 * @returns The authenticated-data bytes.
 */
function aadFor(storeKey: string): Buffer {
  const quoted = JSON.stringify(storeKey);
  return Buffer.from(quoted, 'utf8');
}

/**
 * Collects entries into a record set with no prototype.
 *
 * <p>With no prototype, a `__proto__` store key stays an entry, and no
 * `toJSON` planted on `Object.prototype` applies when it is written.
 * @param entries - Store keys and their entries.
 * @returns The prototype-less record set.
 */
function prototypeLess(entries: readonly (readonly [string, unknown])[]): Record<string, unknown> {
  const records = Object.create(null) as Record<string, unknown>;
  for (const [storeKey, entry] of entries) records[storeKey] = entry;
  return records;
}

/**
 * Opens one sealed record under a derived key.
 * @param storeKey - Store key the record is under.
 * @param entry - Sealed record whose salt matches the key's.
 * @param derived - Key for the file's salt.
 * @returns The record as sealed, or {@link UNREADABLE_ENTRY} when it does not open.
 */
function openSealed(storeKey: string, entry: IEncryptedConfig, derived: IDerivedKey): unknown {
  try {
    const aad = aadFor(storeKey);
    const plaintext = decryptBuffer(entry, derived.key, aad);
    return JSON.parse(plaintext) as unknown;
  } catch {
    return UNREADABLE_ENTRY;
  }
}

/**
 * Opens one entry of a file, refusing anything not sealed under the file's key.
 * @param storeKey - Store key the entry is under.
 * @param entry - Entry as read from the file.
 * @param derived - Key for the file's salt, or why there is none.
 * @returns The record as sealed, or {@link UNREADABLE_ENTRY}.
 */
function openEntry(storeKey: string, entry: unknown, derived: Procedure<IDerivedKey>): unknown {
  if (!derived.success || !isSealedEntry(entry)) return UNREADABLE_ENTRY;
  const salt = saltOf(entry);
  if (!salt.equals(derived.data.salt)) return UNREADABLE_ENTRY;
  return openSealed(storeKey, entry, derived.data);
}

/**
 * Seals one record under the write's key, as an entry with no prototype.
 *
 * <p>The fields are serialised from an object with no prototype too, so a
 * `toJSON` planted on `Object.prototype` cannot replace the token it seals.
 * @param storeKey - Store key the record is written under.
 * @param record - Record to seal; only its token, capture moment and login are kept.
 * @param derived - Key and salt of this write.
 * @returns The sealed record.
 */
function sealRecord(storeKey: string, record: IBankTokenRecord, derived: IDerivedKey): unknown {
  const { token, capturedAt, login } = record;
  const fields = prototypeLess([['token', token], ['capturedAt', capturedAt], ['login', login]]);
  const plaintext = JSON.stringify(fields);
  const aad = aadFor(storeKey);
  const sealed = encryptBuffer(plaintext, derived.key, aad);
  const payload = buildEncryptedPayload({ salt: derived.salt, ...sealed });
  const entry = Object.create(null) as IEncryptedConfig;
  return Object.assign(entry, payload);
}

/** Seals every record under the config password. */
class SealingTokenCipher implements ITokenRecordCipher {
  /**
   * Keeps the password the keys are derived from.
   * @param _password - Non-empty config password.
   */
  constructor(private readonly _password: string) {}

  /**
   * Opens every entry with the key for the salt of the file's first sealed record.
   * @param records - Entries by store key, as read.
   * @returns The opened entries; one that does not open is {@link UNREADABLE_ENTRY}.
   */
  public openRecords(records: StoreRecords): StoreRecords {
    const derived = this.fileKey(records);
    const entries = Object.entries(records);
    const opened = entries.map(([key, entry]) => [key, openEntry(key, entry, derived)] as const);
    return prototypeLess(opened);
  }

  /**
   * Seals every record under one fresh salt.
   * @param records - Records to write, by store key.
   * @returns The sealed entries, or why sealing failed; it never throws.
   */
  public sealRecords(records: Readonly<Record<string, IBankTokenRecord>>): Procedure<StoreRecords> {
    try {
      const salt = randomBytes(SALT_LENGTH);
      const derived = this.derive(salt);
      if (!derived.success) return SEAL_FAILED;
      const entries = Object.entries(records);
      const sealed = entries.map(
        ([key, record]) => [key, sealRecord(key, record, derived.data)] as const,
      );
      const written = prototypeLess(sealed);
      return succeed(written);
    } catch {
      return SEAL_FAILED;
    }
  }

  /**
   * Derives the key for the salt of the file's first sealed record.
   * @param records - Entries by store key, as read.
   * @returns The key, or why there is none.
   */
  private fileKey(records: StoreRecords): Procedure<IDerivedKey> {
    const values = Object.values(records);
    const first = values.find(isSealedEntry);
    if (first === undefined) return NO_SEALED_RECORD;
    const salt = saltOf(first);
    return this.derive(salt);
  }

  /**
   * Derives a key from the password.
   * @param salt - Salt to derive with.
   * @returns The key and its salt, or why derivation failed; it never throws.
   */
  private derive(salt: Buffer): Procedure<IDerivedKey> {
    try {
      const key = deriveKey(this._password, salt);
      return succeed({ salt, key });
    } catch {
      return KEY_UNAVAILABLE;
    }
  }
}

/**
 * Returns the records as the file holds them.
 * @param records - Entries by store key, as read.
 * @returns The same records.
 */
function openAsStored(records: StoreRecords): StoreRecords {
  return records;
}

/**
 * Returns the records to write unchanged.
 * @param records - Records to write, by store key.
 * @returns The same records.
 */
function sealAsGiven(records: Readonly<Record<string, IBankTokenRecord>>): Procedure<StoreRecords> {
  return succeed(records);
}

/**
 * The cipher with no password: records are written and read as they are.
 *
 * <p>A sealed record passes through unopened; it holds no token, so the store
 * counts it as unusable.
 */
export const PLAINTEXT_TOKEN_CIPHER: ITokenRecordCipher = Object.freeze({
  openRecords: openAsStored,
  sealRecords: sealAsGiven,
});

/**
 * Chooses the token cipher for the config password.
 * @param password - Config password; empty when none is set.
 * @returns {@link PLAINTEXT_TOKEN_CIPHER} for an empty password, otherwise a cipher
 *          that seals every record under it.
 */
export default function createTokenRecordCipher(password: string): ITokenRecordCipher {
  if (password.length === 0) return PLAINTEXT_TOKEN_CIPHER;
  return new SealingTokenCipher(password);
}
