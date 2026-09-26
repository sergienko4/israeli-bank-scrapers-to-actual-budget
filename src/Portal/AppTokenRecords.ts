/**
 * The app-token record as stored, and how a stored file is judged.
 *
 * <p>Every field is checked against the shape {@link AppTokenStore} writes, so
 * a hand-edited or truncated file degrades to "no session" instead of
 * crashing the portal. Records that share an `id` or a `tokenHash` are all
 * dropped: keeping one of them would let a revoke hit one copy and miss the
 * other, and dropping them signs those phones out, which fails closed.
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
 * @returns True when the ids and hash have their minted shapes and the names are strings.
 */
function hasIdentity(record: Record<string, unknown>): boolean {
  return matches(record.id, RECORD_ID) && matches(record.familyId, UUID_PATTERN)
    && matches(record.tokenHash, TOKEN_HASH) && typeof record.deviceName === 'string'
    && typeof record.fingerprint === 'string';
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
  return hasIdentity(record) && hasTimestamps(record) && isAuthFactors(record.factors)
    && (record.email === undefined || typeof record.email === 'string');
}

/**
 * Counts how often each value of one field occurs.
 * @param records - Well-formed records.
 * @param field - The field to count.
 * @returns Occurrences per value.
 */
function countBy(records: readonly IAppTokenRecord[], field: 'id' | 'tokenHash'): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) counts.set(record[field], (counts.get(record[field]) ?? 0) + 1);
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
 * Reports whether a snapshot holds exactly what the store writes.
 *
 * <p>An absent file is intact: there is nothing to preserve, so the next
 * write does not look for something to move aside. Expired records count as
 * well formed: dropping them is ordinary pruning, not damage.
 * @param snapshot - The store's snapshot.
 * @param kept - The records kept from it.
 * @returns True when the file is absent, or holds only unique well-formed records.
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
 * @returns The unique well-formed records, expired ones included, and whether the file is intact.
 */
export default function loadTokens(snapshot: IStoreSnapshot): ILoadedTokens {
  const stored: unknown = snapshot.records[TOKENS_RECORD];
  const list: unknown[] = Array.isArray(stored) ? stored : [];
  const wellFormed = list.filter((entry) => isTokenRecord(entry));
  const records = dropCollisions(wellFormed);
  return { records, isIntact: isIntactSnapshot(snapshot, records) };
}
