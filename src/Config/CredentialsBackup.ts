/**
 * A copy of credentials.json, taken for the length of one save.
 *
 * <p>A save renames credentials.json first and config.json second. When the
 * second rename fails, the first has already replaced the credentials, and
 * the pair on disk no longer belongs together: config.json from the previous
 * save beside credentials.json from this one. The copy lets the writer put
 * the previous credentials back. It is read without following a symlink and
 * written under a staging name, owner-only, so a copy a killed save leaves
 * behind is swept like any staged file.
 */

import type { IFileSystem, IOpenFile } from '../Storage/FileSystemPort.js';
import closeAfter from '../Storage/OpenFileScope.js';
import { stagingPathFor } from '../Storage/StagingPaths.js';
import { checkWholeWrite, MAX_STORE_BYTES } from '../Storage/StoreRecords.js';
import type { IProcedureFailure, Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';

/**
 * Reads an open credentials file, refusing anything but a regular file.
 * @param fileSystem - Filesystem the file was opened on.
 * @param file - The open credentials file.
 * @returns Its contents, or why they cannot be copied.
 */
function readRegular(fileSystem: IFileSystem, file: IOpenFile): Procedure<string> {
  if (!file.isRegularFile) {
    return fail('The credentials path is not a regular file', { status: 'EINVAL' });
  }
  return fileSystem.readAll(file, MAX_STORE_BYTES);
}

/** The credentials as they stood before a save, and how to put them back. */
export default class CredentialsBackup {
  private readonly _fileSystem: IFileSystem;

  private readonly _credPath: string;

  private readonly _backupPath: string | undefined;

  /**
   * Holds what {@link take} found.
   * @param fileSystem - Filesystem the credentials live on.
   * @param credPath - Absolute path to credentials.json.
   * @param backupPath - Where the copy is, or undefined on a first save.
   */
  private constructor(fileSystem: IFileSystem, credPath: string, backupPath?: string) {
    this._fileSystem = fileSystem;
    this._credPath = credPath;
    this._backupPath = backupPath;
  }

  /**
   * Copies the current credentials aside. Only `ENOENT` means there is
   * nothing to copy: a symlink, a directory or an unreadable file there is
   * not "nothing", and the save must stop rather than replace it.
   * @param fileSystem - Filesystem the credentials live on.
   * @param credPath - Absolute path to credentials.json.
   * @returns The backup, or why the save must not go ahead.
   */
  public static take(fileSystem: IFileSystem, credPath: string): Procedure<CredentialsBackup> {
    const opened = fileSystem.openForRead(credPath);
    if (!opened.success) {
      if (opened.status !== 'ENOENT') return opened;
      const firstSave = new CredentialsBackup(fileSystem, credPath);
      return succeed(firstSave);
    }
    const contents = closeAfter(
      fileSystem,
      opened.data,
      /**
       * Reads the credentials while the descriptor is open.
       * @param file - The open credentials file.
       * @returns Its contents.
       */
      (file) => readRegular(fileSystem, file),
    );
    if (!contents.success) return contents;
    return CredentialsBackup.copyAside(fileSystem, credPath, contents.data);
  }

  /**
   * Writes the copy exclusively under a fresh staging name and checks it is whole.
   * @param fileSystem - Filesystem the credentials live on.
   * @param credPath - Absolute path to credentials.json.
   * @param contents - The credentials as they are now.
   * @returns The backup, or why the copy could not be made in full.
   */
  private static copyAside(
    fileSystem: IFileSystem,
    credPath: string,
    contents: string,
  ): Procedure<CredentialsBackup> {
    const backupPath = stagingPathFor(credPath);
    const created = fileSystem.createExclusive(backupPath, contents);
    if (!created.success) return created;
    const expected = Buffer.byteLength(contents, 'utf8');
    const whole = checkWholeWrite(created.data.bytesWritten, expected);
    if (!whole.success) {
      fileSystem.remove(backupPath);
      return whole;
    }
    const backup = new CredentialsBackup(fileSystem, credPath, backupPath);
    return succeed(backup);
  }

  /**
   * Puts the credentials back as they were before the save: the copy is
   * renamed over them, or on a first save the new file is removed. A copy
   * that cannot be put back is kept, because it is the only one left.
   * @param failure - What stopped the save.
   * @returns The failure, naming the restore's own failure when there is one.
   */
  public restoreAfter(failure: IProcedureFailure): IProcedureFailure {
    if (this._backupPath === undefined) return this.removeNew(failure);
    const restored = this._fileSystem.rename(this._backupPath, this._credPath);
    if (restored.success) return failure;
    const cause = `could not be put back (${restored.message}) and remain at ${this._backupPath}`;
    return { ...failure, message: `${failure.message}; the previous credentials ${cause}` };
  }

  /**
   * Deletes the copy once it is no longer needed, best-effort: a copy left
   * behind is swept like any staged file.
   * @returns Whether no copy is left.
   */
  public discard(): boolean {
    if (this._backupPath === undefined) return true;
    const removed = this._fileSystem.remove(this._backupPath);
    return removed.success;
  }

  /**
   * Removes the credentials a first save created.
   * @param failure - What stopped the save.
   * @returns The failure, naming the removal's own failure when there is one.
   */
  private removeNew(failure: IProcedureFailure): IProcedureFailure {
    const removed = this._fileSystem.remove(this._credPath);
    if (removed.success) return failure;
    const cause = `could not be removed (${removed.message})`;
    return { ...failure, message: `${failure.message}; the new credentials ${cause}` };
  }
}
