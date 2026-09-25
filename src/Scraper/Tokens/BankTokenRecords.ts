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
 *
 * <p>Every token is bound to the fingerprint of the login that minted it, and
 * a token is usable only while the file binds it to exactly one login. A
 * Pepper or PayBox token logs in by itself, so a token the file cannot vouch
 * for would import whichever account it belongs to.
 */

/** Absence of a token, shared by every "nothing stored" outcome. */
export const NO_TOKEN = '';

/** Absence of a login, for a token nothing binds. */
export const NO_LOGIN = '';

/** A login fingerprint: SHA-256 as 64 lowercase hex characters. */
const LOGIN_FINGERPRINT = /^[\da-f]{64}$/u;

/** One bank account's durable token, when it was captured, and whose it is. */
export interface IBankTokenRecord {
  readonly token: string;
  readonly capturedAt: string;
  /** Fingerprint of the login that minted the token. */
  readonly login: string;
}

/** Tokens understood from a store's records, and how many were unusable. */
export interface ITokenRecords {
  readonly tokens: ReadonlyMap<string, IBankTokenRecord>;
  readonly droppedCount: number;
  /** Every non-blank token the records held, usable or not, for the value masker. */
  readonly seenTokens: readonly string[];
  /** Tokens bound to two or more logins, dropped here, which no write may rebind. */
  readonly contestedTokens: ReadonlySet<string>;
}

/** What an entry with no usable token reads as, and a key with no entry. */
export const NO_RECORD: IBankTokenRecord = Object.freeze({
  token: NO_TOKEN, capturedAt: '', login: NO_LOGIN,
});

/**
 * Tells whether a value is a login fingerprint a token can be bound to.
 * @param login - Candidate fingerprint, taken verbatim.
 * @returns True for exactly 64 lowercase hex characters.
 */
export function isLoginFingerprint(login: string): boolean {
  return LOGIN_FINGERPRINT.test(login);
}

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
  if (typeof entry !== 'object' || entry === null) return NO_RECORD;
  const token = ownString(entry, 'token').trim();
  const capturedAt = ownString(entry, 'capturedAt');
  const login = ownString(entry, 'login');
  return { token, capturedAt, login };
}

/**
 * Tells whether a record holds a token bound to a login.
 * @param record - Record read from one entry.
 * @returns True when both the token and its login are usable.
 */
function isBound(record: IBankTokenRecord): boolean {
  return record.token !== NO_TOKEN && isLoginFingerprint(record.login);
}

/**
 * Finds the tokens the records bind to more than one login.
 *
 * <p>No one of the conflicting bindings can be trusted over the others, so
 * the caller drops every copy.
 * @param records - Bound records from one file.
 * @returns Each token bound to two or more logins.
 */
function contestedTokens(records: readonly IBankTokenRecord[]): ReadonlySet<string> {
  const loginOfToken = new Map<string, string>();
  const contested = new Set<string>();
  for (const { token, login } of records) {
    const bound = loginOfToken.get(token) ?? login;
    if (bound !== login) contested.add(token);
    loginOfToken.set(token, bound);
  }
  return contested;
}

/**
 * Keeps every entry that holds a token bound to one login, counting the rest.
 *
 * <p>Entries are judged one at a time, except that a token bound to two
 * logins costs every entry holding it: a malformed entry costs that account
 * its token and nothing more, because its siblings are the only copies of
 * credentials the bank will not re-issue without another SMS.
 * @param records - Records from a healthy store snapshot.
 * @returns The usable tokens by store key, how many entries were not,
 *          every token seen, and the tokens dropped for two logins.
 */
export function readTokenRecords(records: Readonly<Record<string, unknown>>): ITokenRecords {
  const entries = Object.entries(records);
  const read = entries.map(([storeKey, entry]) => [storeKey, toRecord(entry)] as const);
  const bound = read.filter(([, record]) => isBound(record));
  const boundRecords = bound.map(([, record]) => record);
  const contested = contestedTokens(boundRecords);
  const kept = bound.filter(([, record]) => !contested.has(record.token));
  const seen = read.map(([, record]) => record.token);
  const seenTokens = seen.filter((token) => token !== NO_TOKEN);
  const droppedCount = read.length - kept.length;
  return { tokens: new Map(kept), droppedCount, seenTokens, contestedTokens: contested };
}

/**
 * Copies one record into an object with no prototype.
 *
 * <p>`SecureJsonStore` strips the prototype from the record set, but each
 * entry inside it is still serialised as found. An entry that inherits from
 * `Object.prototype` inherits any `toJSON` planted there, and one planted
 * `toJSON` rewrites every account's token in a write that reports success.
 * With no prototype there is nothing to inherit.
 * @param record - Token, capture moment and login to persist.
 * @returns The same fields on a prototype-less object.
 */
function toStoredEntry(record: IBankTokenRecord): IBankTokenRecord {
  const entry = Object.create(null) as { token: string; capturedAt: string; login: string };
  entry.token = record.token;
  entry.capturedAt = record.capturedAt;
  entry.login = record.login;
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
