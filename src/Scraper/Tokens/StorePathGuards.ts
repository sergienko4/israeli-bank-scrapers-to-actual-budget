/**
 * Guards for the path the bank token store writes to.
 *
 * <p>Every check here answers one question from a different angle: what is
 * actually at this path, and may this module touch it? All of them use
 * `lstat`, never `stat`, so a symlink is judged as a symlink rather than as
 * whatever it points at.
 *
 * <p>Classifying a path and then acting on it are two lookups, so the read
 * here does both through one descriptor opened with `O_NOFOLLOW`, leaving
 * nothing to swap in between them.
 */

import {
  chmodSync, closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync, readFileSync,
} from 'node:fs';

import TokenStoreError from '../../Errors/TokenStoreError.js';

/**
 * Reports whether anything at all occupies the store path.
 *
 * <p>Uses `lstat` rather than `existsSync`, which follows symlinks and so
 * answers "no" for a link pointing at nothing. Treating a dangling link as an
 * absent store meant the next write renamed a fresh file straight over it,
 * destroying the one record of where it pointed.
 * @param filePath - Path to test without following a final symlink.
 * @returns True when something occupies the path.
 */
export function isOccupied(filePath: string): boolean {
  try {
    lstatSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reports whether the path is a real file this module may open or chmod.
 *
 * <p>Uses `lstat`, so a symlink is judged as a symlink rather than as
 * whatever it points at. `statSync` follows the link and `chmodSync` follows
 * it too, so a link dropped at the store path would have had an unrelated
 * file's mode rewritten to 0600 and its contents read as bank tokens. The
 * store only ever creates real files, so a link here is either a mistake or
 * an attempt to aim this module at someone else's file.
 * @param filePath - Path to classify without following a final symlink.
 * @returns True when the path is a regular file.
 */
export function isRealFile(filePath: string): boolean {
  try {
    const stats = lstatSync(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
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
 * directory would strip its execute bit and make it untraversable, and
 * applying it through a symlink would silently re-permission the link's
 * target — a file this module has no business touching at all.
 * @param filePath - File whose permissions must be owner-only.
 * @returns True when the file is now owner-only.
 */
export function enforceOwnerOnly(filePath: string): boolean {
  if (!isRealFile(filePath)) return false;
  try {
    chmodSync(filePath, 0o600);
    return true;
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
 * Reads an open descriptor once it is known to be a regular file.
 * @param descriptor - Open descriptor to classify and read.
 * @returns The file's contents as UTF-8 text.
 * @throws TokenStoreError when the descriptor is not a regular file.
 */
function readRegularFile(descriptor: number): string {
  const stats = fstatSync(descriptor);
  if (!stats.isFile()) {
    throw new TokenStoreError('the store path is not a regular file');
  }
  hardenOpenFile(descriptor);
  return readFileSync(descriptor, 'utf8');
}

/**
 * Reads a file, refusing outright if a symlink occupies the final component.
 *
 * <p>An `lstat` classification and a later `readFileSync` are two separate
 * path lookups, so anything able to replace the final component in between
 * can swap a symlink in after the check and have the read follow it. That
 * window is narrow and needs write access to the store's directory, but the
 * pay-off is a token that bypasses 2FA for years, so it is closed rather
 * than argued about.
 *
 * <p>`O_NOFOLLOW` makes the kernel refuse the open if the final component is
 * a link, and everything after it works on the descriptor the kernel handed
 * back — the same file, whatever happens to the path afterwards.
 * @param filePath - Store path to read without following a final symlink.
 * @returns The file's contents as UTF-8 text.
 * @throws Error when the path is a symlink, absent or not a regular file.
 */
export function readWithoutFollowing(filePath: string): string {
  const descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return readRegularFile(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
