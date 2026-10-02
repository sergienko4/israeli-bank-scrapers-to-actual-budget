/**
 * File-backed registry of mobile-app refresh tokens.
 *
 * Only the SHA-256 hash of a refresh token is persisted, so a stolen copy of
 * this file cannot be replayed against the portal. Every successful refresh
 * rotates the token; presenting an already-rotated one is treated as theft and
 * revokes the whole family, which is what makes a leaked token self-limiting.
 * The one exception is {@link ROTATION_OVERLAP_MS}: a phone whose reply was
 * lost still holds only the token it spent, so for a short while after a
 * rotation that token buys a replacement for its unused successor instead.
 *
 * <p>The file sits on {@link SecureJsonStore}: it is owner-only, a write
 * replaces it whole, and a file holding anything this store would not write
 * back (see {@link loadTokens}) is moved aside on the next write instead of
 * being overwritten. The tokens are stored as one `tokens` record; a bare list
 * an older release wrote is read as that record and written back in the
 * records form. The readers ({@link AppTokenStore.findByToken},
 * {@link AppTokenStore.list}) treat an unreadable file as holding no tokens;
 * every writer throws instead, so an unreadable file is never replaced by one
 * that signs every other phone out.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import StorageError from '../Errors/StorageError.js';
import type { IFileSystem } from '../Storage/FileSystemPort.js';
import SecureJsonStore from '../Storage/SecureJsonStore.js';
import type { ISweepReport } from '../Storage/StoreTypes.js';
import type { Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import type { IAppTokenRecord, ILoadedTokens } from './AppTokenRecords.js';
import loadTokens, { TOKENS_RECORD } from './AppTokenRecords.js';

export type { IAppTokenRecord } from './AppTokenRecords.js';

const DEFAULT_APP_TOKENS_PATH = '/app/data/app-tokens.json';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Default refresh-token lifetime in days. */
export const DEFAULT_REFRESH_TTL_DAYS = 60;

/**
 * How long after a rotation the token it retired may be presented again.
 *
 * A refresh whose reply never reached the phone leaves it holding only the
 * spent token, and its retry would otherwise read as theft and sign it out.
 * Within this window the spent token replaces its successor, as long as that
 * successor was never presented, so a family still has one live token and the
 * holder of the replaced one revokes the family when it presents it. The
 * window is counted from the first rotation and is not extended by a re-grant.
 * A time before the rotation is outside it, so a clock set back cannot
 * stretch it.
 * The app holds a late reply for up to 60 s, so this leaves room for its retry.
 */
export const ROTATION_OVERLAP_MS = 120_000;

/** What a new token family inherits from the authorization that created it. */
export type TokenGrant = Pick<IAppTokenRecord, 'deviceName' | 'email' | 'factors' | 'fingerprint'>;

/**
 * Opens the refresh-token store with the lifetime the tokens it issues get.
 * Callers pass the live lifetime per request, so a changed setting applies to
 * the next token without a restart; tokens already issued keep their expiry.
 */
export type AppTokenOpener = (ttlDays: number) => AppTokenStore;

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
 * Drops expired records. Expired records are pruned on every load so the
 * file cannot grow without bound.
 * @param records - Records as read.
 * @param now - Current epoch milliseconds.
 * @returns The records that have not expired.
 */
function unexpired(records: readonly IAppTokenRecord[], now: number): IAppTokenRecord[] {
  return records.filter((record) => record.expiresAt > now);
}

/**
 * Keeps the records that can still be refreshed: unexpired and not revoked.
 * @param records - Records as read.
 * @param now - Current epoch milliseconds.
 * @returns The live records, in file order.
 */
function liveRecords(records: readonly IAppTokenRecord[], now: number): IAppTokenRecord[] {
  return unexpired(records, now).filter((record) => record.revokedAt === undefined);
}

/**
 * Finds the never-presented successor a spent token may still replace.
 *
 * A rotation records on the spent record the id of the token that replaced
 * it, and a re-grant moves that to the token it issues, so the successor is
 * unused exactly while that record is live. A token never rotated has no
 * successor, and neither has one an earlier release spent, which recorded
 * none: both fail closed, as does a family that was signed out.
 * @param records - The unexpired records as read for this rotation.
 * @param spent - The already-revoked record that was presented.
 * @param now - Current epoch milliseconds.
 * @returns Procedure with the successor, or a failure when `now` is outside
 *   the overlap, which it is before the rotation too, or there is none.
 */
function overlapSuccessor(
  records: readonly IAppTokenRecord[], spent: IAppTokenRecord, now: number,
): Procedure<IAppTokenRecord> {
  const elapsed = now - (spent.revokedAt ?? Number.NEGATIVE_INFINITY);
  if (elapsed < 0 || elapsed > ROTATION_OVERLAP_MS) return fail('Outside the rotation overlap');
  const successor = liveRecords(records, now).find((entry) => entry.id === spent.successorId
    && entry.familyId === spent.familyId);
  if (!successor) return fail('No unused successor');
  return succeed(successor);
}

/** Persists app refresh tokens as hashes in a JSON file on the data volume. */
export class AppTokenStore {
  private readonly _store: SecureJsonStore;

  /**
   * Binds the store to one path on one filesystem.
   * @param fileSystem - Injected filesystem access.
   * @param filePath - Absolute path of the app-tokens JSON file.
   * @param ttlDays - Refresh-token lifetime in days.
   */
  constructor(
    fileSystem: IFileSystem,
    filePath: string,
    private readonly ttlDays = DEFAULT_REFRESH_TTL_DAYS,
  ) {
    this._store = new SecureJsonStore(fileSystem, filePath, { legacyList: TOKENS_RECORD });
  }

  /**
   * Issues the first refresh token of a new family.
   * @param grant - Device, factors and fingerprint captured at authorization.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns The new record together with its one-time plaintext token.
   * @throws StorageError when the current file cannot be read or the new one saved.
   */
  public issue(grant: TokenGrant, now: number = Date.now()): IIssuedToken {
    const loaded = this.loadForWrite();
    const familyId = randomUUID();
    const issued = this.build(familyId, grant, now);
    const kept = unexpired(loaded.records, now);
    this.save([...kept, issued.record], loaded.isIntact);
    return issued;
  }

  /**
   * Looks up a record by the plaintext token the client presented.
   * @param token - The plaintext refresh token.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns The matching record, or undefined when unknown, pruned, or unreadable.
   */
  public findByToken(token: string, now: number = Date.now()): IAppTokenRecord | undefined {
    const hash = hashToken(token);
    return this.readAll(now).find((record) => record.tokenHash === hash);
  }

  /**
   * Rotates a refresh token: the presented record is revoked and a replacement
   * joins the same family. Presenting an already-revoked token means the client
   * or an attacker replayed it, so the whole family is revoked instead, unless
   * it falls within {@link ROTATION_OVERLAP_MS} of its rotation.
   *
   * An expired token reads as unknown, because the load that feeds this drops
   * expired records before anything looks at them.
   * @param token - The plaintext refresh token presented by the client.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns Procedure with the replacement token, or a failure naming the reason.
   * @throws StorageError when the current file cannot be read or the new one saved.
   */
  public rotate(token: string, now: number = Date.now()): Procedure<IIssuedToken> {
    const loaded = this.loadForWrite();
    const records = unexpired(loaded.records, now);
    const hash = hashToken(token);
    const record = records.find((entry) => entry.tokenHash === hash);
    if (!record) return fail('Unknown refresh token');
    if (record.revokedAt !== undefined) return this.rotateSpent(loaded, record, now);
    const issued = this.build(record.familyId, record, now);
    record.revokedAt = now;
    record.lastUsedAt = now;
    record.successorId = issued.record.id;
    this.save([...records, issued.record], loaded.isIntact);
    return succeed(issued);
  }

  /**
   * Revokes the family a live record belongs to, so signing a device out kills
   * its replacements too. It reads the file as a write does, so an unreadable
   * file throws rather than reading as "no such session".
   * @param id - Public record id, as shown in the sessions list.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns True when a live record with that id existed.
   * @throws StorageError when the current file cannot be read or the new one saved.
   */
  public revoke(id: string, now: number = Date.now()): boolean {
    const loaded = this.loadForWrite();
    const record = liveRecords(loaded.records, now).find((entry) => entry.id === id);
    if (!record) return false;
    this.revokeIn(loaded, record.familyId, now);
    return true;
  }

  /**
   * Revokes the family of the record a refresh token belongs to, whether or
   * not that record was already rotated. It reads the file as a write does, so
   * an unreadable file throws rather than reading as "no such token".
   * @param token - The plaintext refresh token.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns True when an unexpired record held that token.
   * @throws StorageError when the current file cannot be read or the new one saved.
   */
  public revokeByToken(token: string, now: number = Date.now()): boolean {
    const loaded = this.loadForWrite();
    const hash = hashToken(token);
    const record = unexpired(loaded.records, now).find((entry) => entry.tokenHash === hash);
    if (!record) return false;
    this.revokeIn(loaded, record.familyId, now);
    return true;
  }

  /**
   * Revokes every live record sharing a family id.
   * @param familyId - The family to kill.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns How many records were revoked by this call.
   * @throws StorageError when the current file cannot be read or the new one saved.
   */
  public revokeFamily(familyId: string, now: number = Date.now()): number {
    const loaded = this.loadForWrite();
    return this.revokeIn(loaded, familyId, now);
  }

  /**
   * Lists the records that can still be refreshed.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns Live records, newest last; none when the file cannot be read.
   */
  public list(now: number = Date.now()): IAppTokenRecord[] {
    const records = this.readAll(now);
    return liveRecords(records, now);
  }

  /**
   * Drops expired records from the file.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns Nothing; the file is rewritten only when something was dropped.
   * @throws StorageError when the current file cannot be read or the new one saved.
   */
  public prune(now: number = Date.now()): void {
    const loaded = this.loadForWrite();
    const kept = unexpired(loaded.records, now);
    if (kept.length !== loaded.records.length) this.save(kept, loaded.isIntact);
  }

  /**
   * Deletes staged files a killed write left beside the file.
   * @returns How many were removed, or why the directory could not be read.
   */
  public sweepStagedLeftovers(): Procedure<ISweepReport> {
    return this._store.sweepStagedLeftovers();
  }

  /**
   * Revokes every live record of a family within records already read.
   * @param loaded - The records as read for this write.
   * @param familyId - The family to kill.
   * @param now - Current epoch milliseconds.
   * @returns How many records were revoked.
   */
  private revokeIn(loaded: ILoadedTokens, familyId: string, now: number): number {
    const records = unexpired(loaded.records, now);
    const doomed = records.filter((r) => r.familyId === familyId && r.revokedAt === undefined);
    for (const record of doomed) record.revokedAt = now;
    if (doomed.length > 0) this.save(records, loaded.isIntact);
    return doomed.length;
  }

  /**
   * Answers a spent token: within the overlap it replaces the unused successor
   * with a new one, and otherwise it is a replay.
   * @param loaded - The records as read for this rotation.
   * @param spent - The already-revoked record that was presented.
   * @param now - Current epoch milliseconds.
   * @returns Procedure with the replacement token, or the replay failure.
   * @throws StorageError when the new file cannot be saved.
   */
  private rotateSpent(
    loaded: ILoadedTokens, spent: IAppTokenRecord, now: number,
  ): Procedure<IIssuedToken> {
    const records = unexpired(loaded.records, now);
    const successor = overlapSuccessor(records, spent, now);
    if (!successor.success) return this.reuseDetected(loaded, spent, now);
    const issued = this.build(spent.familyId, spent, now);
    successor.data.revokedAt = now;
    spent.lastUsedAt = now;
    spent.successorId = issued.record.id;
    this.save([...records, issued.record], loaded.isIntact);
    return succeed(issued);
  }

  /**
   * Handles a replayed refresh token by revoking its family, within the read
   * that caught the replay.
   * @param loaded - The records as read for this rotation.
   * @param record - The already-revoked record that was presented.
   * @param now - Current epoch milliseconds.
   * @returns A failure carrying the record id and revoked count for the caller's WARN.
   */
  private reuseDetected(
    loaded: ILoadedTokens, record: IAppTokenRecord, now: number,
  ): Procedure<IIssuedToken> {
    const revoked = this.revokeIn(loaded, record.familyId, now);
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
   * Reads the unexpired records for a reader.
   * @param now - Current epoch milliseconds.
   * @returns The unexpired records, or none when the file cannot be read.
   */
  private readAll(now: number): IAppTokenRecord[] {
    const loaded = this.load();
    return loaded.success ? unexpired(loaded.data.records, now) : [];
  }

  /**
   * Reads the file once: the records, and whether it holds only what this store writes.
   * @returns The loaded records, or why the file could not be assessed.
   */
  private load(): Procedure<ILoadedTokens> {
    const snapshot = this._store.read();
    if (!snapshot.success) return snapshot;
    const loaded = loadTokens(snapshot.data);
    return succeed(loaded);
  }

  /**
   * Reads the file before a write, refusing to write over one it cannot read.
   * @returns The loaded records.
   * @throws StorageError when the file cannot be assessed.
   */
  private loadForWrite(): ILoadedTokens {
    const loaded = this.load();
    if (!loaded.success) {
      throw new StorageError(`Could not read the app tokens before saving: ${loaded.message}`);
    }
    return loaded.data;
  }

  /**
   * Replaces the file with the given records.
   * @param records - The full record list to persist.
   * @param isIntact - Whether the file being replaced held only what this store writes.
   * @throws StorageError when the new file cannot be saved.
   */
  private save(records: IAppTokenRecord[], isIntact: boolean): void {
    const request = { records: { [TOKENS_RECORD]: records }, shouldQuarantine: !isIntact };
    const committed = this._store.commit(request);
    if (!committed.success) {
      throw new StorageError(`Could not save the app tokens: ${committed.message}`);
    }
  }
}
