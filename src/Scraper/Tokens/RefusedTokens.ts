/**
 * Remembers the long-term tokens an entry sent that were not accepted, so the
 * importer stops sending them.
 *
 * <p>When a login that carries a token fails, OneZero and PayBox fall back to
 * a second cold login. The scraper refuses that second login and reports the
 * refusal instead of the first failure. Sending the same token again fails
 * the same way on every run, so a token that ended a run like that is recorded
 * here and skipped next time.
 *
 * <p>Only a token digest is stored, never the token, so this file is not a
 * second copy of a credential. Each entry keeps its newest distinct digests up
 * to a cap, and nothing else clears one. A token logs in to one account
 * whichever entry sends it, so a digest any entry recorded is refused for
 * every entry.
 *
 * <p>A damaged or unreadable file is not fatal: the caller warns, still sends
 * a token the token store binds to the login, and withholds a configured token
 * it binds to none, since only this file could say another entry retired it.
 * A refusal is never written over a file that could not be read, and a damaged
 * file is set aside before it is replaced.
 */

import type { IFileSystem } from '../../Storage/FileSystemPort.js';
import SecureJsonStore from '../../Storage/SecureJsonStore.js';
import type { ISweepReport } from '../../Storage/StoreTypes.js';
import type { IProcedureFailure, Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/ProcedureHelpers.js';
import { isTokenDigest } from './TokenDigest.js';

/** How many distinct refused digests each entry keeps, newest last. */
export const REFUSALS_PER_ENTRY = 8;

/** What the file says about refused tokens, across every entry. */
export interface IRefusalView {
  /**
   * Tells whether any entry recorded a token digest as refused.
   * @param digest - Digest of the token about to be sent.
   * @returns True when some entry recorded that digest.
   */
  readonly has: (digest: string) => boolean;
  /** False when the file was damaged or held anything this registry does not write. */
  readonly isIntact: boolean;
}

/** Outcome of a refusal: whether the file on disk was replaced. */
export interface IRefusalWrite {
  readonly written: boolean;
}

/** Read/write access to the refused long-term tokens, keyed by store key. */
export interface IRefusedTokens {
  /**
   * Returns what the file says about refused tokens, across every entry.
   * @returns The view, or why the file could not be read.
   */
  read: () => Procedure<IRefusalView>;

  /**
   * Records that a token an entry sent was not accepted.
   * @param storeKey - Opaque key identifying one bank account.
   * @param digest - Digest of the token; never the token itself.
   * @returns Whether the file was replaced, or why it was not.
   */
  refuse: (storeKey: string, digest: string) => Procedure<IRefusalWrite>;

  /**
   * Deletes staged files an earlier run was killed before cleaning up.
   * @returns How many were removed, or why the directory could not be read.
   */
  sweepStagedLeftovers: () => Procedure<ISweepReport>;
}

/** Refused digests by store key, and whether the file held nothing else. */
interface ILoadedRefusals {
  readonly digests: ReadonlyMap<string, readonly string[]>;
  readonly isIntact: boolean;
}

/** One stored entry, as found and as kept. */
interface IReadEntry {
  readonly storeKey: string;
  readonly isIntact: boolean;
  readonly kept: readonly string[];
}

/** Why a refusal that is not a digest is not recorded. Never echoes the value. */
const NOT_A_DIGEST = fail('only a token digest can be recorded');

/**
 * Keeps the newest place of each digest, then the newest few.
 * @param digests - Digests, oldest first.
 * @returns Distinct digests, oldest first, at most {@link REFUSALS_PER_ENTRY}.
 */
function newestDistinct(digests: readonly string[]): string[] {
  const newestFirst = [...digests].reverse();
  const distinct = [...new Set(newestFirst)].reverse();
  return distinct.slice(-REFUSALS_PER_ENTRY);
}

/**
 * Reads one stored entry, keeping only what this registry would write.
 * @param storeKey - The entry's key.
 * @param value - The entry's stored value.
 * @returns The digests kept, and whether nothing else was there.
 */
function readEntry(storeKey: string, value: unknown): IReadEntry {
  if (!Array.isArray(value)) return { storeKey, isIntact: false, kept: [] };
  const digests = value.filter(isTokenDigest);
  const kept = newestDistinct(digests);
  return { storeKey, isIntact: kept.length === value.length, kept };
}

/**
 * Adds a digest as the entry's newest, moving it there if it was already kept.
 * @param kept - The entry's digests, oldest first.
 * @param digest - Digest to add.
 * @returns The entry's digests with the new one last.
 */
function withNewest(kept: readonly string[], digest: string): string[] {
  const others = kept.filter((existing) => existing !== digest);
  return [...others, digest].slice(-REFUSALS_PER_ENTRY);
}

/**
 * Explains a refusal that was not recorded, naming the account but no token.
 * @param storeKey - Opaque key identifying one bank account.
 * @param failure - Why the file was not replaced.
 * @returns The same failure, with the account it concerns.
 */
function notRecorded(storeKey: string, failure: IProcedureFailure): IProcedureFailure {
  const account = `the refused long-term token for ${storeKey}`;
  const message = `Could not record ${account}: ${failure.message}`;
  return fail(message, { status: failure.status, details: failure.details });
}

/** Refused long-term token digests, kept beside the token file. */
export default class RefusedTokens implements IRefusedTokens {
  private readonly _store: SecureJsonStore;

  /**
   * Binds the registry to one file.
   * @param fileSystem - Filesystem the file lives on.
   * @param filePath - Absolute path of the refused-token file.
   */
  constructor(fileSystem: IFileSystem, filePath: string) {
    this._store = new SecureJsonStore(fileSystem, filePath);
  }

  /**
   * Returns what the file says about refused tokens, across every entry.
   *
   * <p>No file reads as no refusals. A damaged file reads as whatever valid
   * digests it still holds, with `isIntact` false so the caller can warn.
   * @returns The view, or why the file could not be read.
   */
  public read(): Procedure<IRefusalView> {
    const loaded = this.load();
    if (!loaded.success) return loaded;
    const everyEntry = [...loaded.data.digests.values()];
    const refused = new Set(everyEntry.flat());
    /**
     * Tells whether any entry recorded a digest.
     * @param digest - Digest of the token about to be sent.
     * @returns True when the digest is refused.
     */
    const has = (digest: string): boolean => refused.has(digest);
    return succeed({ has, isIntact: loaded.data.isIntact });
  }

  /**
   * Records a refused digest as the entry's newest, merging it into what is stored.
   *
   * <p>A file that could not be read is never replaced, and a file that is not
   * intact is set aside first. An intact file whose newest digest for the
   * entry is this one is left as it is.
   * @param storeKey - Opaque key identifying one bank account.
   * @param digest - Digest of the token; never the token itself.
   * @returns Whether the file was replaced, or why it was not.
   */
  public refuse(storeKey: string, digest: string): Procedure<IRefusalWrite> {
    if (!isTokenDigest(digest)) return notRecorded(storeKey, NOT_A_DIGEST);
    const loaded = this.load();
    if (!loaded.success) return notRecorded(storeKey, loaded);
    const kept = loaded.data.digests.get(storeKey) ?? [];
    if (loaded.data.isIntact && kept.at(-1) === digest) return succeed({ written: false });
    const newest = withNewest(kept, digest);
    const digests = new Map(loaded.data.digests).set(storeKey, newest);
    const records = Object.fromEntries(digests);
    const committed = this._store.commit({ records, shouldQuarantine: !loaded.data.isIntact });
    if (!committed.success) return notRecorded(storeKey, committed);
    return succeed({ written: true });
  }

  /**
   * Deletes staged files an earlier run was killed before cleaning up.
   * @returns How many were removed, or why the directory could not be read.
   */
  public sweepStagedLeftovers(): Procedure<ISweepReport> {
    return this._store.sweepStagedLeftovers();
  }

  /**
   * Reads every entry's refused digests, noting whether anything else was on disk.
   * @returns The digests by store key and whether the file was intact, or why
   *          it could not be read.
   */
  private load(): Procedure<ILoadedRefusals> {
    const snapshot = this._store.read();
    if (!snapshot.success) return snapshot;
    const { state, records } = snapshot.data;
    const entries = Object.entries(records).map(([key, value]) => readEntry(key, value));
    const kept = entries.filter((entry) => entry.kept.length > 0);
    const digests = new Map(kept.map((entry) => [entry.storeKey, entry.kept] as const));
    const isStateIntact = state === 'healthy' || state === 'absent';
    const isIntact = isStateIntact && entries.every((entry) => entry.isIntact);
    return succeed({ digests, isIntact });
  }
}
