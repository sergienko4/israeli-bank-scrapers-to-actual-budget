/**
 * File-backed registry of mobile-app refresh tokens.
 *
 * Only the SHA-256 hash of a refresh token is persisted, so a stolen copy of
 * this file cannot be replayed against the portal. Every successful refresh
 * rotates the token; presenting an already-rotated one is treated as theft and
 * revokes the whole family, which is what makes a leaked token self-limiting.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import type { Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import type { IAuthFactors } from './AppAuthCodes.js';
import { isAuthFactors } from './AppAuthCodes.js';

const DEFAULT_APP_TOKENS_PATH = '/app/data/app-tokens.json';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Default refresh-token lifetime in days. */
export const DEFAULT_REFRESH_TTL_DAYS = 60;

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

/** What a new token family inherits from the authorization that created it. */
export type TokenGrant = Pick<IAppTokenRecord, 'deviceName' | 'email' | 'factors' | 'fingerprint'>;

/** A freshly minted refresh token, returned to the client exactly once. */
export interface IIssuedToken {
  record: IAppTokenRecord;
  token: string;
}

/**
 * Resolves the app-token registry path from `APP_TOKENS_PATH`, falling back to
 * the default Docker data path when the env var is unset or blank.
 * @returns The absolute app-tokens file path.
 */
export function resolveAppTokensPath(): string {
  const override = process.env.APP_TOKENS_PATH?.trim();
  return override !== undefined && override.length > 0 ? override : DEFAULT_APP_TOKENS_PATH;
}

/**
 * Hashes a refresh token for storage and lookup.
 * @param token - The plaintext refresh token.
 * @returns Lowercase hex SHA-256 digest.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Whether a parsed entry carries every required string field.
 * @param record - Parsed entry indexed as unknown values.
 * @returns True when all identity fields are strings.
 */
function hasStrings(record: Record<string, unknown>): boolean {
  return typeof record.id === 'string' && typeof record.familyId === 'string'
    && typeof record.tokenHash === 'string' && typeof record.deviceName === 'string'
    && typeof record.fingerprint === 'string';
}

/**
 * Whether a parsed entry carries every required timestamp.
 * @param record - Parsed entry indexed as unknown values.
 * @returns True when all timestamps are numbers and `revokedAt` is absent or numeric.
 */
function hasTimestamps(record: Record<string, unknown>): boolean {
  return typeof record.issuedAt === 'number' && typeof record.lastUsedAt === 'number'
    && typeof record.expiresAt === 'number'
    && (record.revokedAt === undefined || typeof record.revokedAt === 'number');
}

/**
 * Narrows an untrusted parsed entry to a well-formed token record, so a
 * hand-edited or truncated file degrades to "no session" instead of crashing
 * the portal on boot.
 * @param value - One parsed array entry of unknown shape.
 * @returns True when the entry has the full record shape.
 */
function isTokenRecord(value: unknown): value is IAppTokenRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return hasStrings(record) && hasTimestamps(record) && isAuthFactors(record.factors)
    && (record.email === undefined || typeof record.email === 'string');
}

/** Persists app refresh tokens as hashes in a JSON file on the data volume. */
export class AppTokenStore {
  /**
   * Creates a store backed by the given file.
   * @param filePath - Path to the app-tokens JSON file.
   * @param ttlDays - Refresh-token lifetime in days.
   */
  constructor(
    private readonly filePath = resolveAppTokensPath(),
    private readonly ttlDays = DEFAULT_REFRESH_TTL_DAYS,
  ) {}

  /**
   * Issues the first refresh token of a new family.
   * @param grant - Device, factors and fingerprint captured at authorization.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns The new record together with its one-time plaintext token.
   */
  public issue(grant: TokenGrant, now: number = Date.now()): IIssuedToken {
    const familyId = randomUUID();
    return this.append(familyId, grant, now);
  }

  /**
   * Looks up a record by the plaintext token the client presented.
   * @param token - The plaintext refresh token.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns The matching record, or undefined when unknown or already pruned.
   */
  public findByToken(token: string, now: number = Date.now()): IAppTokenRecord | undefined {
    const hash = hashToken(token);
    return this.readAll(now).find((record) => record.tokenHash === hash);
  }

  /**
   * Rotates a refresh token: the presented record is revoked and a replacement
   * joins the same family. Presenting an already-revoked token means the client
   * or an attacker replayed it, so the whole family is revoked instead.
   * @param token - The plaintext refresh token presented by the client.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns Procedure with the replacement token, or a failure naming the reason.
   */
  public rotate(token: string, now: number = Date.now()): Procedure<IIssuedToken> {
    const records = this.readAll(now);
    const hash = hashToken(token);
    const record = records.find((entry) => entry.tokenHash === hash);
    if (!record) return fail('Unknown refresh token');
    if (record.revokedAt !== undefined) return this.reuseDetected(record, now);
    if (record.expiresAt <= now) return fail('Refresh token expired');
    record.revokedAt = now;
    record.lastUsedAt = now;
    const issued = this.build(record.familyId, record, now);
    this.write([...records, issued.record]);
    return succeed(issued);
  }

  /**
   * Revokes the family a record belongs to, so signing a device out kills its
   * replacements too.
   * @param id - Public record id, as shown in the sessions list.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns True when a matching record existed.
   */
  public revoke(id: string, now: number = Date.now()): boolean {
    const record = this.readAll(now).find((entry) => entry.id === id);
    if (!record) return false;
    this.revokeFamily(record.familyId, now);
    return true;
  }

  /**
   * Revokes every live record sharing a family id.
   * @param familyId - The family to kill.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns How many records were revoked by this call.
   */
  public revokeFamily(familyId: string, now: number = Date.now()): number {
    const records = this.readAll(now);
    const doomed = records.filter((r) => r.familyId === familyId && r.revokedAt === undefined);
    for (const record of doomed) record.revokedAt = now;
    if (doomed.length > 0) this.write(records);
    return doomed.length;
  }

  /**
   * Lists the records that can still be refreshed.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns Live records, newest last.
   */
  public list(now: number = Date.now()): IAppTokenRecord[] {
    return this.readAll(now).filter((r) => r.revokedAt === undefined && r.expiresAt > now);
  }

  /**
   * Drops expired records from the file.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns Nothing; the file is rewritten only when something was dropped.
   */
  public prune(now: number = Date.now()): void {
    if (!existsSync(this.filePath)) return;
    const kept = this.readAll(now);
    if (kept.length !== this.parse().length) this.write(kept);
  }

  /**
   * Handles a replayed refresh token by revoking its family.
   * @param record - The already-revoked record that was presented.
   * @param now - Current epoch milliseconds.
   * @returns A failure carrying the record id and revoked count for the caller's WARN.
   */
  private reuseDetected(record: IAppTokenRecord, now: number): Procedure<IIssuedToken> {
    const revoked = this.revokeFamily(record.familyId, now);
    return fail('Refresh token reuse detected', {
      status: 'reused', details: [`id=${record.id}`, `revoked=${String(revoked)}`],
    });
  }

  /**
   * Builds a record plus its one-time token without touching the file.
   * @param familyId - Family the new record joins.
   * @param grant - Device, factors and fingerprint to carry forward.
   * @param now - Current epoch milliseconds.
   * @returns The unsaved record and its plaintext token.
   */
  private build(familyId: string, grant: TokenGrant, now: number): IIssuedToken {
    const token = randomBytes(32).toString('base64url');
    const record: IAppTokenRecord = {
      id: randomBytes(16).toString('base64url'),
      familyId, tokenHash: hashToken(token),
      deviceName: grant.deviceName, factors: { ...grant.factors },
      ...(grant.email === undefined ? {} : { email: grant.email }),
      fingerprint: grant.fingerprint,
      issuedAt: now, lastUsedAt: now, expiresAt: now + this.ttlDays * DAY_MS,
    };
    return { record, token };
  }

  /**
   * Appends a freshly built record to the file.
   * @param familyId - Family the new record joins.
   * @param grant - Device, factors and fingerprint to carry forward.
   * @param now - Current epoch milliseconds.
   * @returns The saved record and its plaintext token.
   */
  private append(familyId: string, grant: TokenGrant, now: number): IIssuedToken {
    const issued = this.build(familyId, grant, now);
    this.write([...this.readAll(now), issued.record]);
    return issued;
  }

  /**
   * Reads the file, dropping malformed and expired entries. Expired records are
   * pruned on every load so the file cannot grow without bound.
   * @param now - Current epoch milliseconds.
   * @returns The still-relevant records.
   */
  private readAll(now: number): IAppTokenRecord[] {
    return this.parse().filter((record) => record.expiresAt > now);
  }

  /**
   * Parses the file without applying the expiry filter.
   * @returns Every well-formed record on disk, or an empty list when absent/corrupt.
   */
  private parse(): IAppTokenRecord[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((entry) => isTokenRecord(entry)) : [];
    } catch {
      return [];
    }
  }

  /**
   * Atomically replaces the token file, owner-readable only.
   * @param records - The full record list to persist.
   * @returns Nothing; the file is replaced before returning.
   */
  private write(records: IAppTokenRecord[]): void {
    const serialized = JSON.stringify(records, null, 2);
    const token = randomUUID();
    const tempPath = `${this.filePath}.${token}.tmp`;
    writeFileSync(tempPath, serialized, { encoding: 'utf8', mode: 0o600 });
    renameSync(tempPath, this.filePath);
  }
}
