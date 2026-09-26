/**
 * Removes the OTP files nothing will read again.
 *
 * <p>A request or an answer is dead an hour after its own deadline: by then
 * the importer has stopped polling and the portal refuses a code, so an orphan
 * code leaves the disk too. One whose deadline cannot be read is aged by its
 * last write instead; files are published whole, so an unreadable one is
 * damage, not a write in progress. Staged copies, and the combined file an
 * older release wrote, go an hour after their last write, as every store's
 * leftovers do. Everything else in the directory is left alone.
 * @module
 */

import type { IFileSystem, IOpenFile } from '../../Storage/FileSystemPort.js';
import { removeIfAbandoned, removeWhenStale } from '../../Storage/StagingSweep.js';
import { MAX_STORE_BYTES, parseSnapshot } from '../../Storage/StoreRecords.js';
import type { ISweepReport } from '../../Storage/StoreTypes.js';
import type { Procedure } from '../../Types/Index.js';
import { succeed } from '../../Types/ProcedureHelpers.js';
import type OtpFileNames from './OtpFileNames.js';
import type { OtpFileKind } from './OtpFileNames.js';

/** Decides whether one entry goes, removing it if so. */
type Sweeper = (fileSystem: IFileSystem, path: string) => boolean;

/**
 * Reads the deadline a request or an answer carries.
 * @param fileSystem - Injected filesystem access.
 * @param file - Descriptor for a regular file.
 * @returns The deadline, or the last write when no finite deadline can be read.
 */
function deadlineOrLastWrite(fileSystem: IFileSystem, file: IOpenFile): number {
  const contents = fileSystem.readAll(file, MAX_STORE_BYTES);
  if (!contents.success) return file.modifiedAtMs;
  const snapshot = parseSnapshot(contents.data);
  const { deadline } = snapshot.records;
  return typeof deadline === 'number' && Number.isFinite(deadline) ? deadline : file.modifiedAtMs;
}

/**
 * Removes a request or an answer an hour past its deadline.
 * @param fileSystem - Injected filesystem access.
 * @param path - The request or answer file.
 * @returns Whether it was removed.
 */
function removeWhenPastDeadline(fileSystem: IFileSystem, path: string): boolean {
  return removeWhenStale(fileSystem, path, (file) => deadlineOrLastWrite(fileSystem, file));
}

/**
 * Leaves an entry that is not an OTP file alone.
 * @returns False: nothing was removed.
 */
function keep(): boolean {
  return false;
}

/** What the sweep does with each kind of entry. */
const SWEEPERS: Readonly<Record<OtpFileKind, Sweeper>> = {
  request: removeWhenPastDeadline,
  answer: removeWhenPastDeadline,
  staged: removeIfAbandoned,
  legacy: removeIfAbandoned,
  other: keep,
};

/**
 * Removes every expired or abandoned OTP file in the directory.
 * @param fileSystem - Injected filesystem access.
 * @param names - The OTP file names under the configured path.
 * @returns How many were removed, or why the directory could not be listed.
 */
export default function sweepOtpFiles(
  fileSystem: IFileSystem,
  names: OtpFileNames,
): Procedure<ISweepReport> {
  const listed = fileSystem.listNames(names.directory);
  if (!listed.success) return listed;
  let removedCount = 0;
  for (const path of listed.data) {
    if (SWEEPERS[names.kindOf(path)](fileSystem, path)) removedCount += 1;
  }
  const summary = `Removed ${String(removedCount)} expired or abandoned OTP files`;
  return succeed({ removedCount, summary });
}
