/**
 * What a stored record must look like to count as a bank token.
 *
 * <p>Pure: nothing here touches the filesystem, which {@link SecureJsonStore}
 * owns. This module owns only the token rules, and one of them matters more
 * than the rest — every entry it is handed but cannot use is *counted*. The
 * adapter uses that count to quarantine the file before its next write, because
 * an entry dropped silently is a credential overwritten with no copy kept, and
 * the bank re-issues it only by SMS. Entries removed before they get here — a
 * `__proto__` key, or an earlier duplicate key — are outside that count.
 */

/** Absence of a token, shared by every "nothing stored" outcome. */
export const NO_TOKEN = '';

/** One bank account's durable token and the moment it was captured. */
export interface IBankTokenRecord {
  readonly token: string;
  readonly capturedAt: string;
}

/** Tokens understood from a store's records, and how many were unusable. */
export interface ITokenRecords {
  readonly tokens: ReadonlyMap<string, IBankTokenRecord>;
  readonly droppedCount: number;
}

/** What an entry with no usable token reads as. */
const UNUSABLE: IBankTokenRecord = Object.freeze({ token: NO_TOKEN, capturedAt: '' });

/**
 * Reads one own string field, never one inherited from a polluted prototype.
 *
 * <p>Parsed entries are ordinary objects. Without the ownership check, a
 * `token` planted on `Object.prototype` elsewhere in the process would turn
 * an entry holding no token into one holding the attacker's.
 * @param fields - Entry already known to be an object.
 * @param name - Field to read.
 * @returns The own string value, or an empty string for anything else.
 */
function ownString(fields: object, name: string): string {
  if (!Object.hasOwn(fields, name)) return '';
  const value: unknown = (fields as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : '';
}

/**
 * Turns one stored entry into a record, which may hold no token.
 *
 * <p>The token is trimmed, so a hand-edited entry of whitespace collapses to
 * {@link NO_TOKEN} instead of a blank credential that would be sent to the
 * bank.
 * @param entry - Value found under one store key.
 * @returns The record, whose token is {@link NO_TOKEN} when unusable.
 */
function toRecord(entry: unknown): IBankTokenRecord {
  if (typeof entry !== 'object' || entry === null) return UNUSABLE;
  const token = ownString(entry, 'token').trim();
  const capturedAt = ownString(entry, 'capturedAt');
  return { token, capturedAt };
}

/**
 * Keeps every entry that holds a usable token, counting the rest.
 *
 * <p>Entries are judged one at a time: a malformed entry costs that account
 * its token and nothing more, because its siblings are the only copies of
 * credentials the bank will not re-issue without another SMS.
 * @param records - Records from a healthy store snapshot.
 * @returns The usable tokens by store key, and how many entries were not.
 */
export function readTokenRecords(records: Readonly<Record<string, unknown>>): ITokenRecords {
  const tokens = new Map<string, IBankTokenRecord>();
  let droppedCount = 0;
  for (const [storeKey, entry] of Object.entries(records)) {
    const record = toRecord(entry);
    if (record.token === NO_TOKEN) droppedCount += 1;
    else tokens.set(storeKey, record);
  }
  return { tokens, droppedCount };
}

/**
 * Copies one record into an object with no prototype.
 *
 * <p>`SecureJsonStore` strips the prototype from the record set, but each
 * entry inside it is still serialised as found. An entry that inherits from
 * `Object.prototype` inherits any `toJSON` planted there, and one planted
 * `toJSON` rewrites every account's token in a write that reports success.
 * With no prototype there is nothing to inherit.
 * @param record - Token and capture moment to persist.
 * @returns The same fields on a prototype-less object.
 */
function toStoredEntry(record: IBankTokenRecord): IBankTokenRecord {
  const entry = Object.create(null) as { token: string; capturedAt: string };
  entry.token = record.token;
  entry.capturedAt = record.capturedAt;
  return entry;
}

/**
 * Converts tokens back into the records the store persists.
 *
 * <p>The record set has no prototype either. Assigning a `__proto__` key onto
 * an ordinary object invokes the prototype setter rather than creating an
 * entry, so the key would vanish instead of reaching `SecureJsonStore`, which
 * refuses it by name.
 * @param tokens - Tokens to persist, keyed by store key.
 * @returns One flat, prototype-less record per store key.
 */
export function toStoreRecords(
  tokens: ReadonlyMap<string, IBankTokenRecord>,
): Record<string, IBankTokenRecord> {
  const records = Object.create(null) as Record<string, IBankTokenRecord>;
  for (const [storeKey, record] of tokens) {
    records[storeKey] = toStoredEntry(record);
  }
  return records;
}
