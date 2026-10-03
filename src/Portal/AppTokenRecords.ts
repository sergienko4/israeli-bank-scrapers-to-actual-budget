/**
 * The app-token record as stored, and how a stored file is judged.
 *
 * <p>Every field is checked against the shape {@link AppTokenStore} writes, so
 * a hand-edited or truncated file degrades to "no session" instead of
 * crashing the portal. An entry carrying a field the store never writes is
 * dropped too: it would otherwise be written back on every save. Records
 * that share an `id` or a `tokenHash` are all dropped: keeping one of them
 * would let a revoke hit one copy and miss the other, and dropping them signs
 * those phones out, which fails closed.
 */

import type { IStoreSnapshot } from '../Storage/StoreTypes.js';
import UUID_PATTERN from '../Utils/IdPatterns.js';
import type { IAuthFactors } from './AppAuthCodes.js';
import { isAuthFactors } from './AppAuthCodes.js';

/** A persisted refresh token. The token itself is never part of this record. */
export interface IAppTokenRecord {
  id: string;
  familyId: string;
  tokenHash: string;
  deviceName: string;
  factors: IAuthFactors;
  email?: string;
  fingerprint: string;
  issuedAt: number;
  lastUsedAt: number;
  expiresAt: number;
  revokedAt?: number;
  /** The token that replaced this one, recorded when it is rotated. */
  successorId?: string;
}

/** The records as read, and whether the file holds only what the store writes. */
export interface ILoadedTokens {
  readonly records: IAppTokenRecord[];
  readonly isIntact: boolean;
}

/** The record the tokens are stored under. */
export const TOKENS_RECORD = 'tokens';

/** A record id: 16 random bytes in base64url. */
const RECORD_ID = /^[\w-]{22}$/;

/** A token hash: a lowercase hex SHA-256 digest. */
const TOKEN_HASH = /^[0-9a-f]{64}$/;

/** Every field a stored record may carry; typed so a new field must be listed. */
const RECORD_FIELDS: Readonly<Record<keyof IAppTokenRecord, true>> = {
  id: true, familyId: true, tokenHash: true, deviceName: true, factors: true, email: true,
  fingerprint: true, issuedAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true,
  successorId: true,
};

/** Every field a stored record's factors carry. */
const FACTOR_FIELDS: Readonly<Record<keyof IAuthFactors, true>> = { google: true, password: true };

/**
 * Whether a parsed object carries no field outside a set.
 * @param value - Parsed object indexed as unknown values.
 * @param allowed - The fields the store writes there.
 * @returns True when every key is one the store writes.
 */
function hasOnlyFields(value: object, allowed: Readonly<Record<string, true>>): boolean {
  return Object.keys(value).every((key) => Object.hasOwn(allowed, key));
}

/**
 * Whether a value is a string matching a pattern.
 * @param value - Parsed value of unknown type.
 * @param pattern - Anchored pattern the string must match.
 * @returns True when the value is a matching string.
 */
function matches(value: unknown, pattern: RegExp): boolean {
  return typeof value === 'string' && pattern.test(value);
}

/**
 * Whether a parsed entry carries every identity field in the shape the store mints.
 * @param record - Parsed entry indexed as unknown values.
 * @returns True when the ids and hash have their minted shapes, the names are
 *   strings, and a recorded successor is a record id on a spent token.
 */
function hasIdentity(record: Record<string, unknown>): boolean {
  return matches(record.id, RECORD_ID) && matches(record.familyId, UUID_PATTERN)
    && matches(record.tokenHash, TOKEN_HASH) && typeof record.deviceName === 'string'
    && typeof record.fingerprint === 'string'
    && (record.successorId === undefined
      || (record.revokedAt !== undefined && matches(record.successorId, RECORD_ID)));
}

/**
 * Whether a parsed entry carries every required timestamp as a finite number.
 * @param record - Parsed entry indexed as unknown values.
 * @returns True when all timestamps are finite and `revokedAt` is absent or finite.
 */
function hasTimestamps(record: Record<string, unknown>): boolean {
  return Number.isFinite(record.issuedAt) && Number.isFinite(record.lastUsedAt)
    && Number.isFinite(record.expiresAt)
    && (record.revokedAt === undefined || Number.isFinite(record.revokedAt));
}

/**
 * Narrows an untrusted parsed entry to a well-formed token record.
 * @param value - One parsed list entry of unknown shape.
 * @returns True when the entry has the full record shape.
 */
function isTokenRecord(value: unknown): value is IAppTokenRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return hasOnlyFields(record, RECORD_FIELDS) && hasIdentity(record) && hasTimestamps(record)
    && isAuthFactors(record.factors) && hasOnlyFields(record.factors, FACTOR_FIELDS)
    && (record.email === undefined || typeof record.email === 'string');
}

/**
 * Counts how often each value of one field occurs, skipping records without it.
 * @param records - Well-formed records.
 * @param field - The field to count.
 * @returns Occurrences per value.
 */
function countBy(
  records: readonly IAppTokenRecord[], field: 'id' | 'tokenHash' | 'familyId' | 'successorId',
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = record[field];
    if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/**
 * Keeps only the records whose `id` and `tokenHash` no other record shares.
 * @param records - Well-formed records.
 * @returns The records outside any collision.
 */
function dropCollisions(records: readonly IAppTokenRecord[]): IAppTokenRecord[] {
  const ids = countBy(records, 'id');
  const hashes = countBy(records, 'tokenHash');
  return records.filter((record) => ids.get(record.id) === 1 && hashes.get(record.tokenHash) === 1);
}

/**
 * Keeps only the families in the shape every write leaves them: at most one
 * unspent token, and no token named as the successor of two others. The
 * rotation overlap relies on both, since a spent token re-grants only by
 * replacing the one unused successor that it alone names. A family breaking
 * either is dropped whole, its spent tokens included, so none of them can be
 * refreshed.
 * @param records - Well-formed records outside any collision.
 * @returns The records of every family in the shape the store writes.
 */
function dropForkedFamilies(records: readonly IAppTokenRecord[]): IAppTokenRecord[] {
  const unspentRecords = records.filter((record) => record.revokedAt === undefined);
  const unspent = countBy(unspentRecords, 'familyId');
  const named = countBy(records, 'successorId');
  const forked = records.filter((record) => (unspent.get(record.familyId) ?? 0) > 1
    || (record.successorId !== undefined && (named.get(record.successorId) ?? 0) > 1));
  const forkedIds = forked.map((record) => record.familyId);
  const forkedFamilies = new Set(forkedIds);
  return records.filter((record) => !forkedFamilies.has(record.familyId));
}

/**
 * Reports whether a snapshot holds exactly what the store writes.
 *
 * <p>An absent file is intact: there is nothing to preserve, so the next
 * write does not look for something to move aside. Expired records count as
 * well formed: dropping them is ordinary pruning, not damage. A file the read
 * stripped of a `__proto__` key is not `healthy`, so it is not intact either.
 * @param snapshot - The store's snapshot.
 * @param kept - The records kept from it.
 * @returns True when the file is absent, or holds only unique well-formed
 *   records, every sign-in in the shape the store writes.
 */
function isIntactSnapshot(snapshot: IStoreSnapshot, kept: readonly IAppTokenRecord[]): boolean {
  if (snapshot.state !== 'healthy') return snapshot.state === 'absent';
  const stored = snapshot.records[TOKENS_RECORD];
  const isOnlyRecord = Object.keys(snapshot.records).length === 1;
  return isOnlyRecord && Array.isArray(stored) && stored.length === kept.length;
}

/**
 * Reads the records out of a snapshot and judges the file.
 * @param snapshot - The store's snapshot.
 * @returns The unique well-formed records of every sign-in in the shape the
 *   store writes, expired ones included, and whether the file is intact.
 */
export default function loadTokens(snapshot: IStoreSnapshot): ILoadedTokens {
  const stored: unknown = snapshot.records[TOKENS_RECORD];
  const list: unknown[] = Array.isArray(stored) ? stored : [];
  const wellFormed = list.filter((entry) => isTokenRecord(entry));
  const unique = dropCollisions(wellFormed);
  const records = dropForkedFamilies(unique);
  return { records, isIntact: isIntactSnapshot(snapshot, records) };
}
