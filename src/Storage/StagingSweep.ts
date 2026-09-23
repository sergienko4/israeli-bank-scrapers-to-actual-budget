/**
 * Collects staged files an earlier run was killed before cleaning up.
 *
 * <p>Separate from the store because it is a different job with a different
 * risk: the store decides what to write, this decides what may be deleted,
 * and the only thing they share is the naming scheme in `StagingPaths`.
 * @module
 */

import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/ProcedureHelpers.js';
import type { IFileSystem, IOpenFile } from './FileSystemPort.js';
import closeAfter from './OpenFileScope.js';
import { directoryOf, isStagingPath } from './StagingPaths.js';
import type { ISweepReport } from './StoreTypes.js';

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
 * Deletes a staged file, reporting only a deletion this process performed.
 *
 * <p>Stricter than the cleanup path, which is satisfied by the file being
 * gone however that happened. Here an already-absent file means a
 * concurrent sweeper won the race, and counting it would have both
 * processes claim the same removal.
 * @param fileSystem - Injected filesystem access.
 * @param stagedPath - Staged file to delete.
 * @returns Whether this call is the one that removed it.
 */
function deleteStaged(fileSystem: IFileSystem, stagedPath: string): boolean {
  try {
    const removed = fileSystem.remove(stagedPath);
    return removed.success && removed.data.wasPresent;
  } catch {
    return false;
  }
}

/**
 * Decides from an open descriptor whether a staged file was abandoned.
 * @param file - Descriptor for the candidate.
 * @returns Whether it is a regular file older than the grace period.
 */
function isAbandoned(file: IOpenFile): Procedure<boolean> {
  const isStale = Date.now() - file.modifiedAtMs > STALE_STAGING_AGE_MS;
  return succeed(file.isRegularFile && isStale);
}

/**
 * Removes one staged file if it is a stale regular file.
 *
 * <p>Anything that will not open — a symlink refused by `O_NOFOLLOW`, a
 * file another process holds exclusively — is left alone, because its age
 * cannot be established and an unaged file might still be in use. A file
 * whose descriptor would not close is left alone for the same reason: the
 * inspection did not finish cleanly, and the next sweep will try again.
 * @param fileSystem - Injected filesystem access.
 * @param stagedPath - Candidate found alongside the store.
 * @returns Whether the file was deleted.
 */
function removeIfAbandoned(fileSystem: IFileSystem, stagedPath: string): boolean {
  const opened = fileSystem.openForRead(stagedPath);
  if (!opened.success) return false;
  const abandoned = closeAfter(fileSystem, opened.data, isAbandoned);
  if (!abandoned.success || !abandoned.data) return false;
  return deleteStaged(fileSystem, stagedPath);
}

/**
 * Deletes every abandoned staged file belonging to one store.
 * @param fileSystem - Injected filesystem access.
 * @param storePath - Canonical path of the store whose leftovers to collect.
 * @returns How many were removed, or why the directory could not be read.
 */
export default function sweepStaged(
  fileSystem: IFileSystem,
  storePath: string,
): Procedure<ISweepReport> {
  const directory = directoryOf(storePath);
  const listed = fileSystem.listNames(directory);
  if (!listed.success) return listed;
  const abandoned = listed.data.filter((name) => isStagingPath(storePath, name));
  let removedCount = 0;
  for (const name of abandoned) {
    if (removeIfAbandoned(fileSystem, name)) removedCount += 1;
  }
  const report: ISweepReport = {
    removedCount,
    summary: `Removed ${String(removedCount)} abandoned staged files`,
  };
  return succeed(report);
}
