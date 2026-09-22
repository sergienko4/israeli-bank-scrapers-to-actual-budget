/**
 * Guards for the path the bank token store writes to.
 *
 * <p>Every check here answers one question from a different angle: what is
 * actually at this path, and may this module touch it? All of them use
 * `lstat`, never `stat`, so a symlink is judged as a symlink rather than as
 * whatever it points at.
 *
 * <p>Classifying a path and then acting on it are two lookups, so anything
 * that opens a file which already exists goes through `useStoreFile`: one
 * descriptor opened with `O_NOFOLLOW`, with nothing left to swap in between.
 *
 * <p>Quarantine is the exception and cannot be otherwise: `rename` takes
 * paths, not descriptors, so `isMovableStore` classifies by path and the
 * caller renames by path. Nothing is followed there either — `rename` moves
 * a final symlink itself rather than its target — so a swap can only change
 * which occupant is moved aside, never what the move reaches.
 */

import {
  closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync, readFileSync,
} from 'node:fs';

import TokenStoreError from '../../Errors/TokenStoreError.js';

/**
 * Flags every open of an existing store uses.
 *
 * <p>Exported so a test can prove the combination behaves as claimed without
 * restating it, which would prove only that the test agrees with itself.
 */
export const STORE_OPEN_FLAGS
  = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/**
 * Reports whether an error means the path holds nothing at all.
 *
 * <p>`ENOENT` is an empty slot and `ENOTDIR` is a path whose parent is not a
 * directory, so neither can hold a store. Every other failure — a permission
 * error, an I/O error on a network mount — means the answer is unknown, and
 * an unknown path must not be reported as empty: the write path would then
 * replace whatever is really there without quarantining it first.
 * @param error - Failure raised while inspecting the path.
 * @returns True when the path is known to hold nothing.
 */
function isMissing(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false;
  return error.code === 'ENOENT' || error.code === 'ENOTDIR';
}

/**
 * Reports whether anything at all occupies the store path.
 *
 * <p>Uses `lstat` rather than `existsSync`, which follows symlinks and so
 * answers "no" for a link pointing at nothing. Treating a dangling link as an
 * absent store meant the next write renamed a fresh file straight over it,
 * destroying the one record of where it pointed.
 *
 * <p>A path that cannot be inspected counts as occupied. That is the safe
 * direction: at worst the read that follows fails and the store is treated
 * as damaged, which preserves whatever is there instead of overwriting it.
 * @param filePath - Path to test without following a final symlink.
 * @returns True when something occupies the path, or the answer is unknown.
 */
export function isOccupied(filePath: string): boolean {
  try {
    lstatSync(filePath);
    return true;
  } catch (error: unknown) {
    return !isMissing(error);
  }
}

/**
 * Restricts a file holding a token to its owner.
 *
 * <p>Applied to every file this module leaves on disk, not only the ones it
 * creates: a store or quarantine copy that arrived with looser permissions —
 * hand-edited, restored from a backup, or inherited through a rename — still
 * holds a credential that bypasses 2FA for years.
 *
 * <p>Hardening is best-effort by policy. Some volumes (notably Windows bind
 * mounts) ignore chmod outright, and refusing to continue there would cost
 * the run its token to fix an exposure that refusing does not reduce. A
 * caller therefore learns whether the file is owner-only; it is not promised.
 *
 * <p>Nothing but a regular file is touched, and the mode is applied to the
 * descriptor rather than the path — a directory would lose the execute bit
 * it needs to stay traversable, and a symlink would silently re-permission
 * a target this module has no business touching.
 *
 * <p>Going through a descriptor means a file its own owner cannot open, such
 * as one restored at mode 0004, is reported as not hardened instead of being
 * chmod'd by path. That is the price of closing the swap window, and it is
 * the right way round: this module never creates such a file, so the case
 * only arises for one an operator already broke, and leaving it as it was
 * beats racing to fix it.
 * @param filePath - File whose permissions should be owner-only.
 * @returns True when the file is now owner-only.
 */
export function enforceOwnerOnly(filePath: string): boolean {
  try {
    return useStoreFile(filePath, hardenOpenFile);
  } catch {
    return false;
  }
}

/**
 * Reports whether the path is something a quarantine rename can move.
 *
 * <p>A regular file is the ordinary case. A symlink is moved too, because
 * leaving it in place would mean writing the next store through it: the
 * rename relocates the link itself and never touches what it points at, so
 * the operator keeps the evidence and the target keeps its contents.
 *
 * <p>Anything else — a directory, a mount point, a socket — is refused. That
 * means the deployment put something unexpected at the store path, and
 * silently relocating it would do more damage than refusing the write.
 * @param filePath - Store path being considered for quarantine.
 * @returns True when the path may be renamed aside.
 */
export function isMovableStore(filePath: string): boolean {
  try {
    const stats = lstatSync(filePath);
    return stats.isFile() || stats.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Hardens an already-open file to owner-only, reporting rather than failing.
 *
 * <p>Works on the descriptor, so it cannot be redirected onto another file
 * between the check and the change. Failure is not fatal: some volumes
 * (notably Windows bind mounts) ignore chmod outright, and refusing to
 * continue there would cost the run its token to fix an exposure that
 * refusing does not reduce.
 * @param descriptor - Open descriptor for the file to restrict.
 * @returns True when the file is now owner-only.
 */
function hardenOpenFile(descriptor: number): boolean {
  try {
    fchmodSync(descriptor, 0o600);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs an operation on an open descriptor known to be a regular file.
 * @param descriptor - Open descriptor to classify, harden and use.
 * @param use - Operation to run once the descriptor is known to be safe.
 * @returns Whatever the operation returned.
 * @throws TokenStoreError when the descriptor is not a regular file.
 */
function useRegularFile<T>(descriptor: number, use: (descriptor: number) => T): T {
  const stats = fstatSync(descriptor);
  if (!stats.isFile()) {
    throw new TokenStoreError('the store path is not a regular file');
  }
  hardenOpenFile(descriptor);
  return use(descriptor);
}

/**
 * Opens the store, refusing outright if a symlink occupies the final name.
 *
 * <p>This is the only way this module touches a file that already exists.
 * Classifying a path and then acting on it are two separate lookups, so
 * anything able to replace the final component in between can swap a symlink
 * in after the check and have the operation follow it. Doing both through
 * one descriptor leaves nothing to swap: `O_NOFOLLOW` makes the kernel
 * refuse the open when the final component is a link, and everything after
 * it works on the handle the kernel returned — the same file, whatever
 * happens to the path afterwards.
 *
 * <p>`O_NOFOLLOW` is POSIX-only; on a host without it the flag reads as zero
 * and the open degrades to an ordinary one. The shipped image is Linux, so
 * the protection holds where the store actually lives.
 *
 * <p>`O_NONBLOCK` is here for the open itself, not for the read. Opening a
 * FIFO for reading waits for a writer, so a pipe left at the store path
 * would hang the importer before `fstat` ever got to reject it. With the
 * flag the open returns at once and the rejection happens as it should.
 * The flag has no effect on the regular files this module actually reads.
 * @param filePath - Store path to open without following a final symlink.
 * @param use - Operation to run on the open descriptor.
 * @returns Whatever the operation returned.
 * @throws Error when the path is a symlink, absent or not a regular file.
 */
function useStoreFile<T>(filePath: string, use: (descriptor: number) => T): T {
  const descriptor = openSync(filePath, STORE_OPEN_FLAGS);
  try {
    return useRegularFile(descriptor, use);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Reads the store without ever following a symlink at its final name.
 * @param filePath - Store path to read.
 * @returns The file's contents as UTF-8 text.
 * @throws Error when the path is a symlink, absent or not a regular file.
 */
export function readWithoutFollowing(filePath: string): string {
  return useStoreFile(filePath, (descriptor) => readFileSync(descriptor, 'utf8'));
}
