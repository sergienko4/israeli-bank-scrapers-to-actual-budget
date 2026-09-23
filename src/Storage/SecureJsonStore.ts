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
  checkWholeWrite, checkWritableSize, damagedReadSnapshot, emptySnapshot, MAX_STORE_BYTES,
  oversizedSnapshot, parseSnapshot, serialiseRecords,
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
 * What the quarantine step did, carrying the name it used.
 *
 * <p>The path travels with the outcome because it is freshly generated on
 * every call: a rollback that recomputed it would name a file that does not
 * exist and silently leave the store missing.
 */
type QuarantineOutcome =
  | { readonly wasQuarantined: false }
  | { readonly wasQuarantined: true; readonly path: string };

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
   * <p>Ordering is the whole point: the replacement is staged, flushed and
   * verified before anything at the canonical path is disturbed, so a crash
   * leaves either the old file or the new one there, never nothing. The
   * staged bytes are fsynced before the rename; the directory entry that
   * rename creates is not, so on a filesystem that reorders metadata a power
   * loss can still show the predecessor. That is the weaker of the two
   * outcomes already promised here, not a third one.
   *
   * <p>One exception, and it is narrow. Quarantining a damaged predecessor
   * takes two renames that cannot be made one, so a crash between them
   * leaves the canonical path empty with the old bytes under the quarantine
   * name. A failure between them is recovered by putting the predecessor
   * back; a `SIGKILL` cannot be, and the next read reports a cold start
   * while the damaged evidence survives for an operator to find.
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
    const whole = checkWholeWrite(staged.data.bytesWritten, sized.data);
    if (!whole.success) return this.abandon(stagedPath, whole);
    const quarantined = this.quarantineIfAsked(request.shouldQuarantine);
    if (!quarantined.success) return this.abandon(stagedPath, quarantined);
    return this.publish(stagedPath, serialised.data.count, quarantined.data);
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
   * Moves the staged replacement onto the canonical path.
   *
   * <p>A failure here is the one case where the predecessor has already been
   * moved aside, so it is put back before the failure is reported. Otherwise
   * a failed commit would leave the store absent while its only copy sat
   * under a quarantine name nothing looks for.
   * @param stagedPath - Path the replacement was staged at.
   * @param recordCount - How many records the staged JSON holds.
   * @param quarantined - What the quarantine step did, and where.
   * @returns The commit report, or the failure that stopped it.
   */
  private publish(
    stagedPath: string,
    recordCount: number,
    quarantined: QuarantineOutcome,
  ): Procedure<ICommitReport> {
    const moved = this._fileSystem.rename(stagedPath, this._filePath);
    if (!moved.success) {
      const reported = this.restorePredecessor(quarantined, moved);
      return this.abandon(stagedPath, reported);
    }
    this.sweepStagedLeftovers();
    return this.reportCommit(recordCount, quarantined.wasQuarantined);
  }

  /**
   * Puts a quarantined predecessor back when the replacement never landed.
   * @param quarantined - What the quarantine step did, and where.
   * @param failure - The failure that stopped the commit.
   * @returns The original failure, noting a restore that did not work.
   */
  private restorePredecessor(
    quarantined: QuarantineOutcome,
    failure: IProcedureFailure,
  ): IProcedureFailure {
    if (!quarantined.wasQuarantined) return failure;
    const restored = this._fileSystem.rename(quarantined.path, this._filePath);
    if (restored.success) return failure;
    const details = [...(failure.details ?? []), `Previous store remains at ${quarantined.path}`];
    return { ...failure, details };
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
   * @returns Where the file was moved, or why one could not be.
   */
  private quarantineIfAsked(shouldQuarantine: boolean): Procedure<QuarantineOutcome> {
    if (!shouldQuarantine) return succeed({ wasQuarantined: false });
    const salvageable = this.screenForQuarantine();
    if (!salvageable.success) return salvageable;
    if (!salvageable.data) return succeed({ wasQuarantined: false });
    const quarantinePath = quarantinePathFor(this._filePath);
    const moved = this._fileSystem.rename(this._filePath, quarantinePath);
    if (moved.success) return succeed({ wasQuarantined: true, path: quarantinePath });
    if (moved.status === 'ENOENT') return succeed({ wasQuarantined: false });
    return moved;
  }

  /**
   * Decides whether what sits at the store path may be moved aside at all.
   *
   * <p>Quarantine renames whatever the name points at, so a directory there
   * would be relocated whole, taking unrelated files with it. Only an entry
   * positively established as movable qualifies: a regular file, or a
   * symlink, where the rename moves the link and never its target.
   *
   * <p>This narrows the window rather than closing it. The type is read from
   * a descriptor, but the rename that follows acts on the name, and Node
   * offers nothing that would let both refer to the same inode.
   * @returns Whether to move it, or why the entry cannot be assessed.
   */
  private screenForQuarantine(): Procedure<boolean> {
    const opened = this._fileSystem.openForRead(this._filePath);
    if (!opened.success) {
      if (ABSENT_ERRNOS.has(opened.status)) return succeed(false);
      if (SQUATTED_ERRNOS.has(opened.status)) return succeed(true);
      return fail(`Cannot assess the store before quarantine: ${opened.status}`, {
        status: opened.status,
      });
    }
    const { isRegularFile } = opened.data;
    this._fileSystem.close(opened.data);
    if (isRegularFile) return succeed(true);
    return fail(`Refusing to quarantine ${this._filePath}: not a regular file`, {
      status: 'ENOTSUP',
    });
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
    if (!file.isRegularFile) {
      const irregular = emptySnapshot('damaged', 'Store path is not a regular file');
      return succeed(irregular);
    }
    const hardened = this._fileSystem.restrictToOwner(file);
    if (file.sizeBytes > MAX_STORE_BYTES) {
      const oversized = oversizedSnapshot(file.sizeBytes);
      return succeed(oversized);
    }
    if (!hardened.success) {
      return fail(`Refusing to read a store left readable by others at ${this._filePath}`, {
        status: hardened.status,
      });
    }
    const contents = this._fileSystem.readAll(file, MAX_STORE_BYTES);
    if (!contents.success) return this.classifyReadFailure(contents.status);
    const snapshot = parseSnapshot(contents.data);
    return succeed(snapshot);
  }

  /**
   * Decides what a failed read means for the store.
   *
   * <p>The distinction is whether the bytes or the attempt were at fault.
   * {@link DAMAGED_READ_SUMMARIES} names the failures that describe the file
   * itself, which the caller can quarantine; everything else is an error the
   * caller must surface.
   * @param status - Errno reported by the read.
   * @returns A damaged snapshot for a faulty file, a failure otherwise.
   */
  private classifyReadFailure(status: string): Procedure<IStoreSnapshot> {
    const damaged = damagedReadSnapshot(status);
    if (damaged.success) return damaged;
    return fail(`Could not read store at ${this._filePath}`, { status });
  }
}
