/**
 * The real {@link IFileSystem}, and the only file in `src/Storage` that may
 * import `node:fs`.
 *
 * <p>Kept deliberately thin. Every operation is one syscall plus error
 * translation, so there is no policy here to get wrong and nothing that needs
 * a test double to exercise. The judgement — what counts as damage, when to
 * quarantine, what order to stage in — belongs above this seam.
 *
 * <p>Exposed as a factory rather than a class because the adapter holds no
 * state; callers inject the returned value wherever an `IFileSystem` is
 * required.
 */

import {
  closeSync, constants, fchmodSync, fstatSync, fsyncSync, openSync, readdirSync, readSync,
  renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type { IProcedureFailure, Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/ProcedureHelpers.js';
import type {
  ICloseOutcome, IFileSystem, IHardenOutcome, IMoveOutcome, IOpenFile, IRemoveOutcome,
  IWriteOutcome,
} from './FileSystemPort.js';

/** Owner read/write only. Anything wider exposes a stored credential. */
const OWNER_ONLY = 0o600;

/**
 * Read flags that refuse a final symlink and never block on a pipe.
 *
 * <p>`O_NOFOLLOW` is what stops a planted link serving another file's bytes
 * as ours. `O_NONBLOCK` matters because a synchronous open of a FIFO waits
 * for a writer that never arrives, stalling the entire process.
 */
export const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/**
 * Create flags that fail when the name is taken and never follow a symlink.
 *
 * <p>`O_EXCL` is what makes staging safe: if anything already holds the name
 * — including a link planted by somebody else — the create fails rather than
 * writing a credential through it.
 */
const CREATE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
  | constants.O_NOFOLLOW;

/**
 * Extracts the errno from a thrown filesystem error.
 * @param error - Value thrown by a `node:fs` call.
 * @returns The errno string, or a generic label when there is none.
 */
function errnoOf(error: unknown): string {
  if (!(error instanceof Error) || !('code' in error)) return 'EUNKNOWN';
  const { code } = error;
  return typeof code === 'string' ? code : 'EUNKNOWN';
}

/**
 * Converts a thrown filesystem error into a typed failure.
 *
 * <p>Carries the subject and the errno and nothing else: these failures are
 * logged, and the payloads being written are credentials.
 * @param action - What was being attempted, for the operator-facing message.
 * @param subject - Path or descriptor involved, which is not itself a secret.
 * @param error - Value thrown by the `node:fs` call.
 * @returns A failure carrying the errno in `status`.
 */
function failed(action: string, subject: string, error: unknown): IProcedureFailure {
  const code = errnoOf(error);
  return fail(`Could not ${action} ${subject}: ${code}`, { status: code });
}

/**
 * Reads the facts an open descriptor reports about itself.
 * @param descriptor - Open file descriptor.
 * @returns The descriptor paired with its `fstat` facts.
 */
function describeOpen(descriptor: number): IOpenFile {
  const stats = fstatSync(descriptor);
  return {
    descriptor,
    sizeBytes: stats.size,
    isRegularFile: stats.isFile(),
    linkCount: stats.nlink,
    modifiedAtMs: stats.mtimeMs,
  };
}

/**
 * Closes a descriptor without propagating a close failure.
 * @param descriptor - Open file descriptor.
 * @returns Whether the descriptor was released cleanly.
 */
function closeQuietly(descriptor: number): ICloseOutcome {
  try {
    closeSync(descriptor);
    return { wasClosed: true };
  } catch {
    return { wasClosed: false };
  }
}

/**
 * Opens a path for reading and resolves its `fstat` facts in one step.
 * @param filePath - Absolute path to open.
 * @returns The open file, or a failure carrying the errno in `status`.
 */
function openForRead(filePath: string): Procedure<IOpenFile> {
  let descriptor = -1;
  try {
    descriptor = openSync(filePath, READ_FLAGS);
    const opened = describeOpen(descriptor);
    return succeed(opened);
  } catch (error: unknown) {
    if (descriptor >= 0) closeQuietly(descriptor);
    return failed('open', filePath, error);
  }
}

/**
 * Fills a buffer from a descriptor until it is full or the file ends.
 * @param descriptor - Descriptor to read sequentially.
 * @param buffer - Destination, whose length bounds the read.
 * @returns How many bytes were placed in the buffer.
 */
function fillFrom(descriptor: number, buffer: Buffer): number {
  let filled = 0;
  while (filled < buffer.length) {
    const read = readSync(descriptor, buffer, filled, buffer.length - filled, null);
    if (read === 0) break;
    filled += read;
  }
  return filled;
}

/**
 * Decoder that rejects malformed input rather than substituting for it.
 *
 * <p>`Buffer.toString('utf8')` replaces every bad sequence with U+FFFD, which
 * can turn a corrupted file into valid JSON holding a silently altered
 * credential. Refusing is the only way the damage stays visible.
 */
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Decodes the filled part of a buffer, refusing to guess at bad bytes.
 * @param buffer - Buffer the read filled.
 * @param length - How many bytes of it are meaningful.
 * @returns The text, or a failure carrying `EILSEQ`.
 */
function decodeUtf8(buffer: Buffer, length: number): Procedure<string> {
  const filled = buffer.subarray(0, length);
  try {
    const text = STRICT_UTF8.decode(filled);
    return succeed(text);
  } catch {
    return fail('Contents are not valid UTF-8', { status: 'EILSEQ' });
  }
}

/**
 * Reads an open descriptor as UTF-8, refusing to allocate past a cap.
 *
 * <p>The cap is enforced here rather than by an earlier `fstat`, because a
 * file can grow between being measured and being read. One byte beyond the
 * cap is requested so that "exactly at the cap" and "over it" are
 * distinguishable without reading the overflow.
 * @param file - Descriptor previously returned by `openForRead`.
 * @param maxBytes - Largest payload to accept.
 * @returns The contents, or a failure carrying the errno in `status`.
 */
function readAll(file: IOpenFile, maxBytes: number): Procedure<string> {
  const subject = `descriptor ${String(file.descriptor)}`;
  const buffer = Buffer.alloc(maxBytes + 1);
  let filled: number;
  try {
    filled = fillFrom(file.descriptor, buffer);
  } catch (error: unknown) {
    return failed('read', subject, error);
  }
  if (filled > maxBytes) {
    return fail(`Contents at ${subject} exceed ${String(maxBytes)} bytes`, { status: 'EFBIG' });
  }
  return decodeUtf8(buffer, filled);
}

/**
 * Restricts an open file to owner-only access, refusing shared inodes.
 *
 * <p>Permissions live on the inode, so changing them through one name changes
 * every name. When another name exists the file is left exactly as found
 * rather than re-permissioning something this process does not own.
 * @param file - Descriptor previously returned by `openForRead`.
 * @returns The mode now in effect, or a failure explaining why it stands.
 */
function restrictToOwner(file: IOpenFile): Procedure<IHardenOutcome> {
  const subject = `descriptor ${String(file.descriptor)}`;
  try {
    const current = fstatSync(file.descriptor);
    if (current.nlink > 1) {
      return fail('Refusing to change permissions on a hard-linked file', { status: 'EMLINK' });
    }
    fchmodSync(file.descriptor, OWNER_ONLY);
    return succeed({ mode: OWNER_ONLY });
  } catch (error: unknown) {
    return failed('harden', subject, error);
  }
}

/**
 * Writes a payload into a file this process has just created.
 *
 * <p>The descriptor is closed before any cleanup so the unlink cannot be
 * refused by an open handle, and the file is removed on failure: a half
 * written credential must never outlive the call that failed to write it.
 *
 * <p>A failing close counts as a failure too. Buffered filesystems report
 * deferred write errors there, so staging a file whose close failed would
 * commit bytes that may never have reached the disk.
 *
 * <p>The payload is flushed before the call returns. Closing a descriptor
 * surfaces deferred errors but does not make the data durable, and the
 * caller's next move is to rename this file over the store: a crash can
 * persist that rename while the contents are still only in page cache,
 * leaving the canonical path pointing at an empty file and every stored
 * credential gone. Flushing the directory entry afterwards is a separate
 * concern and is not needed here — an unpersisted rename leaves the previous
 * state on disk, which is an outcome the commit already promises.
 * @param descriptor - Descriptor for the newly created file.
 * @param filePath - Path that descriptor was created at.
 * @param contents - Payload to write, treated as opaque.
 * @returns The bytes written, or a failure carrying the errno in `status`.
 */
function writeCreated(
  descriptor: number, filePath: string, contents: string,
): Procedure<IWriteOutcome> {
  const bytesWritten = Buffer.byteLength(contents, 'utf8');
  try {
    writeFileSync(descriptor, contents, { encoding: 'utf8' });
    fsyncSync(descriptor);
  } catch (error: unknown) {
    const failure = failed('write', filePath, error);
    closeQuietly(descriptor);
    discardCreated(filePath);
    return failure;
  }
  const closed = closeQuietly(descriptor);
  if (!closed.wasClosed) {
    discardCreated(filePath);
    return fail(`Could not close ${filePath} after staging it`, { status: 'EIO' });
  }
  return succeed({ bytesWritten });
}

/**
 * Creates a new owner-only file, refusing a path that is already taken.
 * @param filePath - Absolute path to create.
 * @param contents - Payload to write, treated as opaque.
 * @returns The bytes staged, or a failure carrying the errno in `status`.
 */
function createExclusive(filePath: string, contents: string): Procedure<IWriteOutcome> {
  let descriptor = -1;
  try {
    descriptor = openSync(filePath, CREATE_FLAGS, OWNER_ONLY);
    fchmodSync(descriptor, OWNER_ONLY);
  } catch (error: unknown) {
    if (descriptor >= 0) {
      closeQuietly(descriptor);
      discardCreated(filePath);
    }
    return failed('create', filePath, error);
  }
  return writeCreated(descriptor, filePath, contents);
}

/**
 * Moves a path onto another, replacing the destination atomically.
 * @param fromPath - Existing path to move.
 * @param toPath - Destination, replaced if it exists.
 * @returns The destination path, or a failure carrying the errno.
 */
function rename(fromPath: string, toPath: string): Procedure<IMoveOutcome> {
  try {
    renameSync(fromPath, toPath);
    return succeed({ path: toPath });
  } catch (error: unknown) {
    return failed('rename', fromPath, error);
  }
}

/**
 * Removes a path, treating an already-absent path as success.
 *
 * <p>Absence is judged from the unlink itself rather than a preceding
 * `lstat`, so there is no window in which the answer can change between the
 * question and the act.
 * @param filePath - Absolute path to remove.
 * @returns Whether anything was deleted, or why the path remains.
 */
function remove(filePath: string): Procedure<IRemoveOutcome> {
  try {
    unlinkSync(filePath);
    return succeed({ wasPresent: true });
  } catch (error: unknown) {
    if (errnoOf(error) === 'ENOENT') return succeed({ wasPresent: false });
    return failed('remove', filePath, error);
  }
}

/**
 * Deletes a file this process created but failed to finish writing.
 *
 * <p>Best effort by design: the caller is already returning the failure that
 * matters, and a half-written credential left behind is a worse outcome than
 * a cleanup error nobody reads.
 * @param filePath - Absolute path to remove.
 * @returns Whether the partial file is known to be gone.
 */
function discardCreated(filePath: string): boolean {
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lists the full paths of everything directly inside a directory.
 * @param directoryPath - Directory to list.
 * @returns The paths, or a failure carrying the errno in `status`.
 */
function listNames(directoryPath: string): Procedure<readonly string[]> {
  try {
    const names = readdirSync(directoryPath);
    const paths = names.map((name) => join(directoryPath, name));
    return succeed(paths);
  } catch (error: unknown) {
    return failed('list', directoryPath, error);
  }
}

/**
 * Releases a descriptor held in an open file handle.
 * @param file - Descriptor previously returned by `openForRead`.
 * @returns Whether the descriptor was released cleanly.
 */
function closeFile(file: IOpenFile): ICloseOutcome {
  return closeQuietly(file.descriptor);
}

/**
 * Builds filesystem access backed by real syscalls.
 * @returns An immutable {@link IFileSystem} for injection.
 */
export default function createNodeFileSystem(): IFileSystem {
  return Object.freeze({
    openForRead,
    readAll,
    restrictToOwner,
    close: closeFile,
    createExclusive,
    rename,
    listNames,
    remove,
  });
}
