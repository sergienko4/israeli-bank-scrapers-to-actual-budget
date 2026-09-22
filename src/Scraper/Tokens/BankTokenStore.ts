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
 * reading it are in `BankTokenFile`.
 */

import { randomUUID } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
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

/** Outcome of a write: whether a token was actually persisted. */
export interface IBankTokenWrite {
  readonly written: boolean;
}

/** Read/write access to the durable long-term tokens, keyed by bank id. */
export interface IBankTokenStore {
  /**
   * Returns the stored long-term token for a bank.
   * @param bankId - Bank identifier used as the store key.
   * @returns The stored token, or an empty string when none is available.
   */
  read: (bankId: string) => string;

  /**
   * Persists a bank's long-term token, replacing any previous value.
   * @param bankId - Bank identifier used as the store key.
   * @param token - The long-term token to persist.
   * @returns Procedure reporting whether a token was written.
   */
  write: (bankId: string, token: string) => Procedure<IBankTokenWrite>;
}

/**
 * Restricts a file holding a token to its owner.
 *
 * <p>Applied to every path this module leaves on disk, not only the ones it
 * creates: a store or quarantine copy that arrived with looser permissions —
 * hand-edited, restored from a backup, or inherited through a rename — still
 * holds a credential that bypasses 2FA for years.
 *
 * <p>Failure is not fatal. Some volumes (notably Windows bind mounts) ignore
 * chmod outright, and refusing to continue there would cost the run its
 * token to fix an exposure that refusing does not actually reduce.
 *
 * <p>Only a regular file is touched. Applying an owner-only mode to a
 * directory would strip its execute bit and make it untraversable, breaking
 * every later read of a deployment that mounted something unexpected at the
 * store path.
 * @param filePath - File whose permissions must be owner-only.
 * @returns True when the file is now owner-only.
 */
function enforceOwnerOnly(filePath: string): boolean {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) return false;
    chmodSync(filePath, 0o600);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the timestamped name a damaged store is set aside under.
 * @param filePath - Store path being quarantined.
 * @returns Sibling path carrying the quarantine moment.
 */
function quarantineName(filePath: string): string {
  const stamp = new Date();
  const iso = stamp.toISOString();
  // Colons are legal on Linux but not on a Windows bind mount, and the data
  // volume is routinely one; a name that cannot be created saves nothing.
  const suffix = iso.replaceAll(':', '-');
  return `${filePath}.${suffix}.corrupt`;
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
 *
 * <p>Only a regular file is moved. A directory at the store path means the
 * deployment mounted something unexpected there, and silently relocating a
 * mount point would do more damage than refusing the write.
 * @param filePath - Store path whose contents could not be understood.
 * @returns True when a quarantine copy was kept.
 */
function quarantineStore(filePath: string): boolean {
  const target = quarantineName(filePath);
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) return false;
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
 * Stages the payload then renames it into place, cleaning up on failure.
 * @param tempPath - Sibling temp file staged before the rename.
 * @param serialized - Complete JSON payload to persist.
 * @param target - Final path the temp file is renamed onto.
 * @returns True once the rename into place has completed.
 * @throws Error when staging or renaming fails.
 */
function commitTemp(tempPath: string, serialized: string, target: string): boolean {
  try {
    writeFileSync(tempPath, serialized, { encoding: 'utf8', mode: 0o600 });
    renameSync(tempPath, target);
    return true;
  } catch (error: unknown) {
    rmSync(tempPath, { force: true });
    const detail = errorMessage(error);
    throw error instanceof Error ? error : new Error(detail);
  }
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
   * @param bankId - Bank identifier used as the store key.
   * @returns The stored token, or an empty string when none is available.
   */
  public read(bankId: string): string {
    const store = this.readStore();
    const record = store.records.get(bankId);
    return record ? record.token : NO_TOKEN;
  }

  /**
   * Persists a bank's long-term token, replacing any previous value.
   *
   * <p>Blank tokens are ignored rather than stored: the provider returns an
   * empty string when a run produced no durable artifact, and writing it would
   * erase a working token.
   * @param bankId - Bank identifier used as the store key.
   * @param token - The long-term token to persist.
   * @returns Procedure reporting whether a token was written, or a typed failure.
   */
  public write(bankId: string, token: string): Procedure<IBankTokenWrite> {
    const trimmed = token.trim();
    if (trimmed.length === 0) return succeed({ written: false });
    try {
      return this.persist(bankId, trimmed);
    } catch (error: unknown) {
      const detail = errorMessage(error);
      return fail(`Failed to persist the long-term token for ${bankId}: ${detail}`);
    }
  }

  /**
   * Records the token, or re-secures the store when it is already current.
   *
   * <p>The unchanged case still touches the file. Rewriting it would be
   * pointless work, but skipping it entirely was worse: the atomic write is
   * the only thing that restores owner-only permissions, so a store left
   * world-readable stayed that way for as long as the token kept working —
   * which for these banks is years.
   * @param bankId - Bank identifier used as the store key.
   * @param token - Non-blank token to record for that bank.
   * @returns Procedure reporting whether a token was written.
   * @throws Error when the directory cannot be created or the file written.
   */
  private persist(bankId: string, token: string): Procedure<IBankTokenWrite> {
    const current = this.read(bankId);
    if (current === token) {
      enforceOwnerOnly(this.filePath);
      return succeed({ written: false });
    }
    const contents = this.merge(bankId, token);
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
   * @returns The stored records and whether the file was intact.
   */
  private readStore(): IStoreRead {
    if (!existsSync(this.filePath)) return { records: new Map(), isIntact: true };
    enforceOwnerOnly(this.filePath);
    try {
      const raw = readFileSync(this.filePath, 'utf8');
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
   * @param bankId - Bank identifier used as the store key.
   * @param token - Non-blank token to record for that bank.
   * @returns The complete file contents to persist.
   * @throws TokenStoreError when a damaged store could not be preserved.
   */
  private merge(bankId: string, token: string): IBankTokenFile {
    const store = this.readStore();
    if (!store.isIntact) this.setAsideDamaged();
    const now = new Date();
    const capturedAt = now.toISOString();
    store.records.set(bankId, { token, capturedAt });
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
   * Writes the file atomically with owner-only permissions.
   *
   * <p>The 0600 file mode is the protection that matters and holds on every
   * write, including one that replaces a file left behind with looser
   * permissions. The 0700 directory mode applies only when this code creates
   * the directory: the shipped image already provisions `/app/data` as 0755,
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
