/**
 * The filesystem boundary for stores that persist secrets to disk.
 *
 * <p>This is the only seam in `src/Storage` allowed to reach `node:fs`.
 * Everything above it — damage classification, quarantine, staging order — is
 * pure logic over this contract, so it can be tested against an in-memory
 * double instead of mocking the `node:fs` module globally.
 *
 * <p>Operations report failure through the Result pattern rather than
 * throwing, and carry the underlying errno (`ENOENT`, `ELOOP`, `EEXIST`, ...)
 * in `status`. Callers classify on that code: the difference between "nothing
 * is here" and "something is here that I could not read" decides whether the
 * write path may claim the path or must quarantine it first.
 */

import type { Procedure } from '../Types/Procedure.js';

/**
 * An open descriptor together with the facts `fstat` reported for it.
 *
 * <p>The facts travel with the descriptor deliberately. Asking the filesystem
 * about a path and then opening that path are two lookups, and anything able
 * to replace the final component in between makes the answer describe a file
 * the caller never opened. Bundling them forces the implementation to resolve
 * both in one step, so no consumer can reintroduce that window.
 */
export interface IOpenFile {
  /** Handle for subsequent descriptor-based operations. */
  readonly descriptor: number;
  /** Size reported at open time, used to refuse implausibly large files. */
  readonly sizeBytes: number;
  /** False for directories, devices and pipes, which must never be parsed. */
  readonly isRegularFile: boolean;
  /** Names pointing at this inode; above one, re-permissioning is unsafe. */
  readonly linkCount: number;
  /**
   * Last modification time in milliseconds since the epoch.
   *
   * <p>Read from the descriptor rather than the path, so the age belongs to
   * the file that was actually opened.
   */
  readonly modifiedAtMs: number;
}

/** Permission state left in place after a hardening attempt. */
export interface IHardenOutcome {
  /** Mode now in effect, so callers can log what was actually achieved. */
  readonly mode: number;
}

/** Result of releasing a descriptor. */
export interface ICloseOutcome {
  /** False when the descriptor was already gone or refused to close. */
  readonly wasClosed: boolean;
}

/** Result of staging a payload. */
export interface IWriteOutcome {
  /** Bytes committed, so a truncated write is visible to the caller. */
  readonly bytesWritten: number;
}

/** Result of moving a path. */
export interface IMoveOutcome {
  /** Path the content now lives at. */
  readonly path: string;
}

/** Result of removing a path. */
export interface IRemoveOutcome {
  /** True when something was actually deleted, not merely already absent. */
  readonly wasPresent: boolean;
}

/** Filesystem operations a secret-bearing store needs, and nothing more. */
export interface IFileSystem {
  /**
   * Opens a path for reading without following a final symlink.
   *
   * <p>Must not block when the path is a FIFO or a device: a synchronous
   * blocking open would stall the whole process. Must resolve the descriptor
   * and its `fstat` facts as a single step.
   * @param filePath - Absolute path to open.
   * @returns The open file, or a failure carrying the errno in `status`.
   */
  openForRead(filePath: string): Procedure<IOpenFile>;

  /**
   * Reads an open descriptor as UTF-8, refusing to allocate past a cap.
   *
   * <p>The cap belongs here, with the read that does the allocating, rather
   * than with an earlier size observation: a file can grow between being
   * measured and being read.
   * @param file - Descriptor previously returned by `openForRead`.
   * @param maxBytes - Largest payload to accept before failing with `EFBIG`.
   * @returns The file contents, or a failure carrying the errno in `status`.
   */
  readAll(file: IOpenFile, maxBytes: number): Procedure<string>;

  /**
   * Restricts an open file to owner-only access.
   *
   * <p>Implementations must refuse when the inode carries more than one name.
   * Permissions belong to the inode, not the name, so re-permissioning a
   * hard-linked file would silently change a file the caller does not own.
   * @param file - Descriptor previously returned by `openForRead`.
   * @returns The mode now in effect, or a failure explaining why it stands.
   */
  restrictToOwner(file: IOpenFile): Procedure<IHardenOutcome>;

  /**
   * Releases a descriptor. Never throws, so it is safe in cleanup paths.
   * @param file - Descriptor previously returned by `openForRead`.
   * @returns Whether the descriptor was released cleanly.
   */
  close(file: IOpenFile): ICloseOutcome;

  /**
   * Creates a new file with owner-only permissions, failing if it exists.
   *
   * <p>Exclusive creation is what makes this safe for secrets: a plain write
   * follows a symlink planted at the path and sends the payload somewhere
   * else, and it also ignores the requested mode when the path already
   * exists. `EEXIST` means the caller does not own the path and must not
   * delete what is there.
   * @param filePath - Absolute path to create.
   * @param contents - Payload to write, treated as opaque.
   * @returns The bytes staged, or a failure carrying the errno in `status`.
   */
  createExclusive(filePath: string, contents: string): Procedure<IWriteOutcome>;

  /**
   * Moves a path onto another, replacing the destination atomically.
   * @param fromPath - Existing path to move.
   * @param toPath - Destination, replaced if it exists.
   * @returns The destination path, or a failure carrying the errno.
   */
  rename(fromPath: string, toPath: string): Procedure<IMoveOutcome>;

  /**
   * Lists the full paths of everything directly inside a directory.
   *
   * <p>Full paths rather than bare names, so no caller has to join them and
   * no caller can get the separator wrong on a foreign platform.
   * @param directoryPath - Directory to list.
   * @returns The paths, or a failure carrying the errno in `status`.
   */
  listNames(directoryPath: string): Procedure<readonly string[]>;

  /**
   * Removes a path if present, reporting rather than throwing on failure.
   * @param filePath - Absolute path to remove.
   * @returns Whether anything was deleted, or why the path remains.
   */
  remove(filePath: string): Procedure<IRemoveOutcome>;
}
