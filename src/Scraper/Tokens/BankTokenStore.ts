/**
 * File-backed store of the durable long-term tokens API-direct banks mint.
 *
 * <p>OneZero, Pepper and PayBox return a long-lived re-login artifact after a
 * successful SMS login. Replaying it skips the SMS on every subsequent run, so
 * it is the difference between one 2FA prompt and one per scrape. It is a
 * standing bypass of the second factor and is stored with the same care as a
 * password: owner-only permissions, never logged, never placed in config.
 *
 * <p>Writes are atomic (temp file plus rename) because a scrape interrupted
 * mid-write would otherwise leave a truncated token that fails every future
 * warm start. Every operation is total: an unreadable store yields "no token"
 * and an unwritable store yields a typed failure, so a broken store degrades
 * the run to a cold login rather than failing it.
 *
 * <p>One writer is assumed. The read-modify-write is synchronous, so banks
 * scraped within a single importer cannot interleave, but two importer
 * processes sharing one file can still lose an update. That is bounded and
 * self-correcting rather than destructive: the loser's bank keeps its
 * previous token, the provider rejects it, and the scraper falls back to a
 * cold login that re-mints and overwrites. The cost is one SMS, which is why
 * no lock is taken — a lock able to wedge a scheduled scrape would be worse
 * than the failure it prevents. Running two importers against one account is
 * unsupported for a stronger reason anyway: each mint revokes the last.
 *
 * <p>Only the filesystem side lives here; the on-disk shape and the rules for
 * reading it are in `BankTokenFile`, and the checks that decide what may be
 * touched at the store path are in `StorePathGuards`.
 */

import { randomUUID } from 'node:crypto';
import {
  mkdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import TokenStoreError from '../../Errors/TokenStoreError.js';
import type { Procedure } from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import { errorMessage } from '../../Utils/Index.js';
import type { IBankTokenFile, IStoreRead } from './BankTokenFile.js';
import {
  damagedRead, NO_TOKEN, readBankMap, toFile,
} from './BankTokenFile.js';
import resolveBankTokensPath from './BankTokenPath.js';
import {
  enforceOwnerOnly, isMovableStore, isOccupied, readWithoutFollowing,
} from './StorePathGuards.js';

/** Outcome of a write: whether a token was actually persisted. */
export interface IBankTokenWrite {
  readonly written: boolean;
}

/**
 * Read/write access to the durable long-term tokens, keyed by store key.
 *
 * <p>The key is opaque and must be stored verbatim. Production passes
 * `bankId:accountKey` (see `buildTokenStoreKey`) so that two accounts at one
 * bank keep separate tokens; an implementation that canonicalised, lowercased
 * or truncated the key would collapse them back onto one entry, and since
 * every mint revokes the token it replaces, the two accounts would then cost
 * an SMS each on every single run.
 */
export interface IBankTokenStore {
  /**
   * Returns the stored long-term token for one bank account.
   * @param storeKey - Opaque key identifying one bank account in the store.
   * @returns The stored token, or an empty string when none is available.
   */
  read: (storeKey: string) => string;

  /**
   * Persists one bank account's long-term token, replacing any previous value.
   * @param storeKey - Opaque key identifying one bank account in the store.
   * @param token - The long-term token to persist.
   * @returns Procedure reporting whether a token was written.
   */
  write: (storeKey: string, token: string) => Procedure<IBankTokenWrite>;
}

/**
 * Builds the unique name a damaged store is set aside under.
 *
 * <p>The timestamp alone resolves only to the millisecond, and `rename`
 * replaces its destination without complaint. Two quarantines in the same
 * millisecond would therefore leave the second silently sitting on top of
 * the first, destroying a salvage copy holding a credential the bank
 * re-issues only by SMS. The random component makes every target distinct.
 * @param filePath - Store path being quarantined.
 * @returns Sibling path carrying the quarantine moment and a unique mark.
 */
function quarantineName(filePath: string): string {
  const stamp = new Date();
  const iso = stamp.toISOString();
  // Colons are legal on Linux but not on a Windows bind mount, and the data
  // volume is routinely one; a name that cannot be created saves nothing.
  const suffix = iso.replaceAll(':', '-');
  const unique = randomUUID();
  return `${filePath}.${suffix}.${unique}.corrupt`;
}

/**
 * Moves a damaged store aside before it is overwritten.
 *
 * <p>The file holds credentials valid for years that the bank re-issues only
 * by SMS, and re-issuing revokes whatever is still live. Overwriting a file
 * nobody has inspected therefore destroys the only salvageable copy, so it is
 * renamed next to the store for an operator to examine.
 *
 * <p>The copy is re-hardened after the rename because a rename carries the
 * original file's permissions with it: quarantining a world-readable store
 * would otherwise leave the same live credential exposed under a new name.
 * A quarantined symlink is left alone by that step, which is the point.
 * @param filePath - Store path whose contents could not be understood.
 * @returns True when a quarantine copy was kept.
 */
function quarantineStore(filePath: string): boolean {
  if (!isMovableStore(filePath)) return false;
  const target = quarantineName(filePath);
  try {
    renameSync(filePath, target);
    enforceOwnerOnly(target);
    return true;
  } catch {
    // The caller decides what a lost quarantine copy costs; here it is only
    // reported, because refusing to continue is not always the right answer.
    return false;
  }
}

/**
 * Removes one staged temp file best-effort, swallowing any error.
 *
 * <p>A temp file that cannot be deleted is not a reason to hide why the
 * write failed: the removal error explains nothing the operator can act on,
 * while the commit error explains everything. The leftover carries the
 * store's own 0600 mode and a name no read path ever looks for.
 * @param tempPath - Temp path to remove; a missing path is a no-op.
 * @returns True when the file was removed, false when the error was swallowed.
 */
function removeTemp(tempPath: string): boolean {
  try {
    rmSync(tempPath, { force: true });
    return true;
  } catch {
    // Best-effort cleanup: ignore so the original commit error still throws.
    return false;
  }
}

/**
 * Stages the payload then renames it into place, cleaning up on failure.
 *
 * <p>Staging is exclusive (`wx`). The default `w` flag follows a symlink and
 * reuses an existing file, so anything already sitting at the staging path
 * would receive the token: the payload lands in a file this code does not
 * own, and `mode` is ignored for a file that already exists, so it lands
 * there with whatever permissions that file had. The random suffix makes the
 * path hard to guess, but `wx` means guessing it correctly still achieves
 * nothing — the create fails rather than writing through the link.
 * @param tempPath - Sibling temp file staged before the rename.
 * @param serialized - Complete JSON payload to persist.
 * @param target - Final path the temp file is renamed onto.
 * @returns True once the rename into place has completed.
 * @throws Error when staging or renaming fails, never when cleanup does.
 */
function commitTemp(tempPath: string, serialized: string, target: string): boolean {
  try {
    writeFileSync(tempPath, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(tempPath, target);
    return true;
  } catch (error: unknown) {
    removeTemp(tempPath);
    const detail = errorMessage(error);
    throw error instanceof Error ? error : new Error(detail);
  }
}

/**
 * Reports whether the file already holds exactly what a write would store.
 *
 * <p>Intactness is part of the question, not a separate one. A store can hold
 * this bank's token unchanged while another entry is unreadable, and treating
 * that as "nothing to do" left the damage on disk with no quarantine and no
 * record — the fast path reads a token, so the one signal that the rest of
 * the file was lost went nowhere. A damaged store is therefore always
 * rewritten: the original is set aside, and what could still be read is
 * written back clean.
 * @param store - Records read from the file, with their intactness.
 * @param storeKey - Opaque key identifying one bank account in the store.
 * @param token - Non-blank token the caller is about to store.
 * @returns True when the file is intact and already holds that token.
 */
function isAlreadyStored(store: IStoreRead, storeKey: string, token: string): boolean {
  if (!store.isIntact) return false;
  const record = store.records.get(storeKey);
  return record ? record.token === token : false;
}

/** Durable long-term bank tokens persisted on the shared data volume. */
export default class BankTokenStore implements IBankTokenStore {
  /**
   * Creates a store backed by the given file.
   * @param filePath - Path to the bank-token JSON file.
   */
  constructor(private readonly filePath: string = resolveBankTokensPath()) {}

  /**
   * Returns the stored long-term token for a bank.
   *
   * <p>A missing, unreadable or malformed store is indistinguishable from
   * "never captured": both mean the next run must perform a cold login.
   * @param storeKey - Opaque key identifying one bank account in the store.
   * @returns The stored token, or an empty string when none is available.
   */
  public read(storeKey: string): string {
    const store = this.readStore();
    const record = store.records.get(storeKey);
    return record ? record.token : NO_TOKEN;
  }

  /**
   * Persists a bank's long-term token, replacing any previous value.
   *
   * <p>Blank tokens are ignored rather than stored: the provider returns an
   * empty string when a run produced no durable artifact, and writing it would
   * erase a working token.
   * @param storeKey - Opaque key identifying one bank account in the store.
   * @param token - The long-term token to persist.
   * @returns Procedure reporting whether a token was written, or a typed failure.
   */
  public write(storeKey: string, token: string): Procedure<IBankTokenWrite> {
    const trimmed = token.trim();
    if (trimmed.length === 0) return succeed({ written: false });
    try {
      return this.persist(storeKey, trimmed);
    } catch (error: unknown) {
      const detail = errorMessage(error);
      return fail(`Failed to persist the long-term token for ${storeKey}: ${detail}`);
    }
  }

  /**
   * Records the token, or asks for owner-only permissions again when the
   * store is already current.
   *
   * <p>The unchanged case returns without rewriting the file. That is safe
   * only because the read above already asked for owner-only permissions
   * through the descriptor it opened: a store left world-readable has them
   * re-asserted on every run that touches it, not only on the runs that
   * happen to change its contents. Asking is best-effort, as it is
   * everywhere else — see `enforceOwnerOnly` for why.
   *
   * <p>One read serves both the decision and the merge, so the file cannot
   * change between them and a damaged store cannot be judged twice.
   * @param storeKey - Opaque key identifying one bank account in the store.
   * @param token - Non-blank token to record for that bank.
   * @returns Procedure reporting whether a token was written.
   * @throws Error when the directory cannot be created or the file written.
   */
  private persist(storeKey: string, token: string): Procedure<IBankTokenWrite> {
    const store = this.readStore();
    if (isAlreadyStored(store, storeKey, token)) return succeed({ written: false });
    const contents = this.merge(store, storeKey, token);
    this.commit(contents);
    return succeed({ written: true });
  }

  /**
   * Reads the current records from disk.
   *
   * <p>Reports whether the whole file was understood, because "no tokens yet"
   * and "this file is damaged" call for different handling on the write path:
   * the first is routine, the second must not be overwritten unrecorded.
   *
   * <p>Hardens the file before reading it. A warm run can touch the store on
   * this path alone — `withWarmToken` replays the stored token and a scrape
   * that mints nothing new never reaches `write()` — so leaving the mode to
   * the write path meant a file restored or hand-edited at 0644 stayed
   * world-readable for as long as the token kept working.
   *
   * <p>The occupancy check sits inside the same guard as the read. It answers
   * rather than throws today, but a guard outside would let any future throw
   * escape `read()` and fail a scrape over a store that only needed to be
   * treated as damaged.
   *
   * <p>Anything that is not a regular file is reported as damage rather than
   * read. Following a symlink here would serve an unrelated file's JSON as
   * this importer's bank tokens, and a link pointing at nothing is damage
   * rather than an empty store: it is evidence the write path must set aside
   * before it can claim the path. Both the classification and the read
   * happen through one `O_NOFOLLOW` descriptor, so a link cannot be swapped
   * in between them.
   * @returns The stored records and whether the file was intact.
   */
  private readStore(): IStoreRead {
    try {
      if (!isOccupied(this.filePath)) return { records: new Map(), isIntact: true };
      const raw = readWithoutFollowing(this.filePath);
      const parsed = JSON.parse(raw) as unknown;
      return readBankMap(parsed);
    } catch {
      // A corrupt store is treated as absent so the run falls back to a cold
      // login instead of failing; the write path quarantines it first.
      return damagedRead();
    }
  }

  /**
   * Builds the next file contents with one bank's token replaced.
   * @param store - Records already read from disk, reused as the merge base.
   * @param storeKey - Opaque key identifying one bank account in the store.
   * @param token - Non-blank token to record for that bank.
   * @returns The complete file contents to persist.
   * @throws TokenStoreError when a damaged store could not be preserved.
   */
  private merge(store: IStoreRead, storeKey: string, token: string): IBankTokenFile {
    if (!store.isIntact) this.setAsideDamaged();
    const now = new Date();
    const capturedAt = now.toISOString();
    store.records.set(storeKey, { token, capturedAt });
    return toFile(store.records);
  }

  /**
   * Moves a damaged store aside, refusing the write when that is impossible.
   *
   * <p>Proceeding anyway would overwrite the only recoverable copy of a file
   * the bank will not re-issue without another SMS. Refusing costs this run
   * its freshly captured token and the next run one SMS, which is recoverable;
   * destroying a salvageable credential is not.
   * @returns True once the damaged store has been preserved.
   * @throws TokenStoreError when the damaged store could not be preserved.
   */
  private setAsideDamaged(): boolean {
    const isKept = quarantineStore(this.filePath);
    if (isKept) return true;
    throw new TokenStoreError(
      `the damaged store at ${this.filePath} could not be set aside, so it was left untouched`,
    );
  }

  /**
   * Writes the file atomically, requesting owner-only permissions.
   *
   * <p>The 0600 file mode is requested on every write, including one that
   * replaces a file left behind with looser permissions. A volume that
   * ignores the mode — some bind mounts do — is accepted rather than
   * refused, for the reason given on `enforceOwnerOnly`. The 0700 directory
   * mode applies only when this code creates the directory: the shipped image already provisions `/app/data` as 0755,
   * and re-chmod'ing a shared mount point to suit one file would be a
   * surprise for everything else living there. A listable directory is
   * harmless while the file itself stays unreadable.
   * @param contents - The complete file contents to persist.
   * @returns True once the rename into place has completed.
   * @throws Error when the directory cannot be created or the file written.
   */
  private commit(contents: IBankTokenFile): boolean {
    const directory = dirname(this.filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const unique = randomUUID();
    const tempPath = `${this.filePath}.${unique}.tmp`;
    const serialized = JSON.stringify(contents, null, 2);
    return commitTemp(tempPath, serialized, this.filePath);
  }
}
