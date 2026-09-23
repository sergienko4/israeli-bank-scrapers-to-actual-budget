/**
 * Pure store policy over an injected {@link IFileSystem}.
 *
 * <p>Holds every judgement the previous hand-rolled stores got wrong — what
 * counts as damage, what is too large to read, which keys are hostile — and
 * none of the syscalls. That split is what lets the awkward cases be tested
 * with an in-memory double instead of a temp directory and `vi.mock`.
 *
 * <p>One assumption is not enforced here and cannot be: that no untrusted
 * user can create or rename entries in the store's directory. Node exposes
 * no directory-relative rename, so a staged path can in principle be
 * substituted between creation and commit. The image builds `/app/data`
 * owned by `node`, but a bind mount replaces those bits, so whoever mounts
 * the volume owns this invariant.
 */

import type { IProcedureFailure, Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/ProcedureHelpers.js';
import type { IFileSystem, IOpenFile } from './FileSystemPort.js';
import {
  directoryOf, isStagingPath, quarantinePathFor, stagingPathFor,
} from './StagingPaths.js';
import {
  checkWritableSize, emptySnapshot, MAX_STORE_BYTES, parseSnapshot, serialiseRecords,
} from './StoreRecords.js';
import type {
  ICommitReport, ICommitRequest, IStoreSnapshot, ISweepReport,
} from './StoreTypes.js';

/**
 * How long a staged file must go untouched before it counts as abandoned.
 *
 * <p>Exclusive creation and best-effort cleanup between them cover every
 * failure this code can observe, but not a `SIGKILL` landing between the two:
 * that leaves a live token under a name nothing revisits. The threshold is
 * what makes collecting it safe, because a staged file is otherwise
 * indistinguishable from one a concurrent commit is about to rename.
 *
 * <p>An operational heuristic, not a proof of abandonment. A producer
 * stopped for longer than this — `SIGSTOP`, a wall-clock jump, a backdated
 * mtime from the same user — can have its staged file collected while still
 * live. It then fails its rename and reports the failure, so the cost is a
 * failed commit rather than a corrupted store. Excluding that entirely needs
 * a single-writer lease, which is not worth its cost here.
 */
export const STALE_STAGING_AGE_MS = 60 * 60 * 1000;

/**
 * Open failures meaning nothing is there yet, which is a normal cold start.
 *
 * <p>Only `ENOENT` qualifies. `ENOTDIR` looks similar but means a parent
 * component is a file, so the path cannot be created or quarantined either;
 * calling that "no store yet" would invite a commit that cannot succeed.
 */
const ABSENT_ERRNOS = new Set(['ENOENT']);

/** Open failures meaning something is squatting the path. */
const SQUATTED_ERRNOS = new Set(['ELOOP']);

/**
 * Whether an open store is worth reading, and what to report when it is not.
 *
 * <p>A union rather than an optional snapshot, because "nothing to report"
 * and "report this damage" are different answers and collapsing them into
 * `undefined` is how one of them gets dropped.
 */
type ScreenOutcome =
  | { readonly isReadable: true }
  | { readonly isReadable: false; readonly snapshot: IStoreSnapshot };

/**
 * Rejects an open file the store must not read, before any bytes are taken.
 *
 * <p>Both refusals are damage rather than failure: something is at the
 * canonical path, so calling it absent would license overwriting it.
 * @param file - Descriptor returned by the open.
 * @returns Whether to proceed, with the snapshot to report when not.
 */
function screenOpened(file: IOpenFile): ScreenOutcome {
  if (!file.isRegularFile) {
    const irregular = emptySnapshot('damaged', 'Store path is not a regular file');
    return { isReadable: false, snapshot: irregular };
  }
  if (file.sizeBytes > MAX_STORE_BYTES) {
    const size = String(file.sizeBytes);
    const oversized = emptySnapshot('damaged', `Store is ${size} bytes, above the cap`);
    return { isReadable: false, snapshot: oversized };
  }
  return { isReadable: true };
}

/** Reads and writes a JSON record store without trusting what it finds. */
export default class SecureJsonStore {
  private readonly _fileSystem: IFileSystem;

  private readonly _filePath: string;

  /**
   * Binds the store to one path on one filesystem.
   * @param fileSystem - Injected filesystem access.
   * @param filePath - Absolute path of the store.
   */
  constructor(fileSystem: IFileSystem, filePath: string) {
    this._fileSystem = fileSystem;
    this._filePath = filePath;
  }

  /**
   * Reads the store, classifying absence and damage rather than throwing.
   * @returns A snapshot, or a failure when the path cannot be assessed.
   */
  public read(): Procedure<IStoreSnapshot> {
    const opened = this._fileSystem.openForRead(this._filePath);
    if (!opened.success) return this.classifyOpenFailure(opened.status);
    try {
      return this.readOpened(opened.data);
    } finally {
      this._fileSystem.close(opened.data);
    }
  }

  /**
   * Replaces the store's contents, optionally moving a damaged file aside.
   *
   * <p>Ordering is the whole point: the replacement is staged first, so a
   * crash at any later step leaves either the old file or the new one at the
   * canonical path, never nothing.
   * @param request - Records to persist and whether to quarantine first.
   * @returns What the commit did, or why it did nothing.
   */
  public commit(request: ICommitRequest): Procedure<ICommitReport> {
    const serialised = serialiseRecords(request.records);
    if (!serialised.success) return serialised;
    const sized = checkWritableSize(serialised.data.json);
    if (!sized.success) return sized;
    const stagedPath = stagingPathFor(this._filePath);
    const staged = this._fileSystem.createExclusive(stagedPath, serialised.data.json);
    if (!staged.success) return staged;
    const quarantined = this.quarantineIfAsked(request.shouldQuarantine);
    if (!quarantined.success) return this.abandon(stagedPath, quarantined);
    const moved = this._fileSystem.rename(stagedPath, this._filePath);
    if (!moved.success) return this.abandon(stagedPath, moved);
    this.sweepStagedLeftovers();
    return this.reportCommit(serialised.data.count, quarantined.data);
  }

  /**
   * Deletes staged files an earlier run was killed before cleaning up.
   *
   * <p>Only files older than {@link STALE_STAGING_AGE_MS} are touched. A
   * staged file is otherwise indistinguishable from one a concurrent commit
   * is seconds away from renaming, and deleting that would turn this from a
   * tidy-up into data loss.
   *
   * <p>Public because a successful commit is not a sufficient trigger on its
   * own: a process that crashes and never commits again would keep its
   * leftover for ever, and one that commits within the grace period is too
   * early to collect it. Whoever owns the process lifecycle should also call
   * this after startup, once the grace period has passed.
   * @returns How many were removed, or why the directory could not be read.
   */
  public sweepStagedLeftovers(): Procedure<ISweepReport> {
    const directory = directoryOf(this._filePath);
    const listed = this._fileSystem.listNames(directory);
    if (!listed.success) return listed;
    const abandoned = listed.data.filter((name) => isStagingPath(this._filePath, name));
    let removedCount = 0;
    for (const name of abandoned) {
      if (this.removeIfAbandoned(name)) removedCount += 1;
    }
    const report: ISweepReport = {
      removedCount,
      summary: `Removed ${String(removedCount)} abandoned staged files`,
    };
    return succeed(report);
  }

  /**
   * Removes one staged file if it is a stale regular file.
   *
   * <p>Anything that will not open — a symlink refused by `O_NOFOLLOW`, a
   * file another process holds exclusively — is left alone, because its age
   * cannot be established and an unaged file might still be in use.
   * @param stagedPath - Candidate found alongside the store.
   * @returns Whether the file was deleted.
   */
  private removeIfAbandoned(stagedPath: string): boolean {
    const opened = this._fileSystem.openForRead(stagedPath);
    if (!opened.success) return false;
    const { isRegularFile, modifiedAtMs } = opened.data;
    this._fileSystem.close(opened.data);
    if (!isRegularFile) return false;
    if (Date.now() - modifiedAtMs <= STALE_STAGING_AGE_MS) return false;
    return this.deleteStaged(stagedPath);
  }

  /**
   * Deletes a staged file, reporting only a deletion this process performed.
   *
   * <p>Stricter than the cleanup path, which is satisfied by the file being
   * gone however that happened. Here an already-absent file means a
   * concurrent sweeper won the race, and counting it would have both
   * processes claim the same removal.
   * @param stagedPath - Staged file to delete.
   * @returns Whether this call is the one that removed it.
   */
  private deleteStaged(stagedPath: string): boolean {
    try {
      const removed = this._fileSystem.remove(stagedPath);
      return removed.success && removed.data.wasPresent;
    } catch {
      return false;
    }
  }

  /**
   * Builds the report for a commit that reached the canonical path.
   * @param recordCount - How many records the staged JSON actually held.
   * @param wasQuarantined - Whether a damaged predecessor was moved aside.
   * @returns The completed report.
   */
  private reportCommit(
    recordCount: number,
    wasQuarantined: boolean,
  ): Procedure<ICommitReport> {
    const count = String(recordCount);
    const report: ICommitReport = {
      path: this._filePath,
      wasQuarantined,
      summary: `Committed ${count} records`,
    };
    return succeed(report);
  }

  /**
   * Moves the current file aside when the caller reported it as damaged.
   *
   * <p>An absent file is not a failure: there is simply nothing to salvage.
   * Any other failure aborts the commit, because destroying a damaged file
   * loses the only evidence of what went wrong.
   * @param shouldQuarantine - Whether the caller asked for a quarantine.
   * @returns Whether a file was moved aside, or why one could not be.
   */
  private quarantineIfAsked(shouldQuarantine: boolean): Procedure<boolean> {
    if (!shouldQuarantine) return succeed(false);
    const quarantinePath = quarantinePathFor(this._filePath);
    const moved = this._fileSystem.rename(this._filePath, quarantinePath);
    if (moved.success) return succeed(true);
    if (moved.status === 'ENOENT') return succeed(false);
    return moved;
  }

  /**
   * Abandons a commit, removing the staged credential before reporting.
   *
   * <p>The original failure is always the one returned. A cleanup problem is
   * appended as a detail rather than replacing it, because the caller needs
   * to know why the commit failed far more than why the tidy-up did.
   * @param stagedPath - Path the replacement was staged at.
   * @param failure - The failure that stopped the commit.
   * @returns The original failure, noting any cleanup problem.
   */
  private abandon(stagedPath: string, failure: IProcedureFailure): IProcedureFailure {
    const wasRemoved = this.removeQuietly(stagedPath);
    if (wasRemoved) return failure;
    const details = [...(failure.details ?? []), `Staged file remains at ${stagedPath}`];
    return { ...failure, details };
  }

  /**
   * Removes a path without letting the removal's outcome escape.
   * @param filePath - Path to remove.
   * @returns Whether the path is known to be gone.
   */
  private removeQuietly(filePath: string): boolean {
    try {
      const removed = this._fileSystem.remove(filePath);
      return removed.success;
    } catch {
      return false;
    }
  }

  /**
   * Decides what a failed open means for the store.
   * @param status - Errno reported by the open.
   * @returns A snapshot for expected errnos, or a failure for the rest.
   */
  private classifyOpenFailure(status: string): Procedure<IStoreSnapshot> {
    if (ABSENT_ERRNOS.has(status)) {
      const absent = emptySnapshot('absent', `No store at ${this._filePath}`);
      return succeed(absent);
    }
    if (SQUATTED_ERRNOS.has(status)) {
      const squatted = emptySnapshot('damaged', `Store path is a symlink (${status})`);
      return succeed(squatted);
    }
    return fail(`Could not open store at ${this._filePath}: ${status}`, { status });
  }

  /**
   * Assesses an open descriptor and reads it when it is safe to do so.
   * @param file - Descriptor returned by the open.
   * @returns A snapshot, or a failure when the contents cannot be read.
   */
  private readOpened(file: IOpenFile): Procedure<IStoreSnapshot> {
    const screened = screenOpened(file);
    if (!screened.isReadable) return succeed(screened.snapshot);
    this._fileSystem.restrictToOwner(file);
    const contents = this._fileSystem.readAll(file, MAX_STORE_BYTES);
    if (!contents.success) return this.classifyReadFailure(contents.status);
    const snapshot = parseSnapshot(contents.data);
    return succeed(snapshot);
  }

  /**
   * Decides what a failed read means for the store.
   *
   * <p>`EFBIG` is damage rather than an error: the file was within the cap
   * when it was measured and grew past it before it could be read, which is
   * exactly the behaviour an attacker would produce.
   * @param status - Errno reported by the read.
   * @returns A damaged snapshot for an overgrown store, a failure otherwise.
   */
  private classifyReadFailure(status: string): Procedure<IStoreSnapshot> {
    if (status !== 'EFBIG') {
      return fail(`Could not read store at ${this._filePath}`, { status });
    }
    const grew = emptySnapshot('damaged', 'Store grew past the cap while being read');
    return succeed(grew);
  }
}
