/**
 * Best-effort removal of the files one OTP request leaves on disk.
 *
 * <p>Nothing here throws or reports: a file that cannot be removed, or a
 * directory that cannot be listed, is left for the startup sweep, which
 * takes it an hour after its last write.
 */
import type { IFileSystem } from '../../Storage/FileSystemPort.js';
import type OtpFileNames from './OtpFileNames.js';

/** Removes a request's files by name, best-effort. */
export default class OtpFileRemoval {
  private readonly _fileSystem: IFileSystem;

  private readonly _names: OtpFileNames;

  /**
   * Binds the removal to the store's filesystem and names.
   * @param fileSystem - Injected filesystem access.
   * @param names - The names every OTP file derives from.
   */
  constructor(fileSystem: IFileSystem, names: OtpFileNames) {
    this._fileSystem = fileSystem;
    this._names = names;
  }

  /**
   * Removes what a settled request leaves on disk besides its answer.
   *
   * <p>The request file goes first, so the portal stops accepting a code for
   * it before any staged copy is removed.
   * @param id - The settled request's id.
   */
  public retire(id: string): void {
    this.removeRequest(id);
    this.removeAnswerStages(id);
  }

  /**
   * Removes a published code no importer will take, and any staged copy of it.
   * @param id - The request the code was published for.
   */
  public withdraw(id: string): void {
    const answerPath = this._names.answerPath(id);
    this._fileSystem.remove(answerPath);
    this.removeAnswerStages(id);
  }

  /**
   * Removes a request's own file, so the portal stops offering it.
   * @param id - The request id.
   */
  public removeRequest(id: string): void {
    const requestPath = this._names.requestPath(id);
    this._fileSystem.remove(requestPath);
  }

  /**
   * Removes every staged copy of a request's answer.
   *
   * <p>A publish links its stage to the answer's name, then unlinks the stage;
   * if the unlink fails, the stage keeps the answer's contents under a second
   * name, so a tombstone would not take the code off the disk.
   * @param id - The request id.
   */
  private removeAnswerStages(id: string): void {
    const listed = this._fileSystem.listNames(this._names.directory);
    if (!listed.success) return;
    const stages = this._names.answerStagesOf(id, listed.data);
    for (const stage of stages) this._fileSystem.remove(stage);
  }
}
