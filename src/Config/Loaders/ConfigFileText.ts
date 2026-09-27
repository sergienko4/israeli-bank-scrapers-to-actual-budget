/**
 * Reads one config file's text without trusting what sits at its path.
 *
 * <p>config.json and credentials.json are read at every start. A plain read
 * waits forever on a FIFO, pulls a device or a huge file into memory, and
 * swaps bad UTF-8 for U+FFFD, which can silently alter a stored password.
 * This read opens the path once and refuses anything that is not a regular
 * file, is over 8 MiB, or is not valid UTF-8. Only a missing file (ENOENT)
 * counts as absent, so a config that exists but cannot be read is reported
 * rather than mistaken for no config at all.
 *
 * <p>It follows a symlink, because mounted configs are often links; that is
 * why it does not use the storage port, which refuses them by design.
 */

import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

import type { IProcedureFailure, Procedure } from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';

/** Read-only, following a symlink, and never waiting for a FIFO's writer. */
export const CONFIG_READ_FLAGS = constants.O_RDONLY | constants.O_NONBLOCK;

/** The largest config file read, far above any real config. */
export const MAX_CONFIG_BYTES = 8 * 1024 * 1024;

/** Refuses malformed bytes, and keeps a byte-order mark as a plain read did. */
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Reports a failed open or read by the file and its errno only.
 * @param filePath - The file being read.
 * @param error - Value thrown by the `node:fs` call.
 * @returns A failure carrying the errno in `status`.
 */
function unreadable(filePath: string, error: unknown): IProcedureFailure {
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code : 'EUNKNOWN';
  return fail(`Could not read ${filePath}: ${code}`, { status: code });
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
 * Decodes the bytes read, refusing to guess at a malformed sequence.
 * @param bytes - The file's contents.
 * @param filePath - The file, for the failure message.
 * @returns The text, or a failure carrying `EILSEQ`.
 */
function decode(bytes: Buffer, filePath: string): Procedure<string> {
  try {
    const text = STRICT_UTF8.decode(bytes);
    return succeed(text);
  } catch {
    return fail(`${filePath} is not valid UTF-8`, { status: 'EILSEQ' });
  }
}

/**
 * Reads at most one byte past the cap, which is enforced by the read itself
 * since a file can grow after `fstat`.
 * @param descriptor - Descriptor to read.
 * @param filePath - The file, for the failure message.
 * @returns The bytes, or a failure carrying `EFBIG`.
 */
function readCapped(descriptor: number, filePath: string): Procedure<Buffer> {
  const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
  const filled = fillFrom(descriptor, buffer);
  if (filled > MAX_CONFIG_BYTES) {
    return fail(`${filePath} is larger than 8 MiB`, { status: 'EFBIG' });
  }
  const bytes = buffer.subarray(0, filled);
  return succeed(bytes);
}

/**
 * Reads an open descriptor, checking it is a regular file within the cap.
 * @param descriptor - Descriptor opened with {@link CONFIG_READ_FLAGS}.
 * @param filePath - The file, for failure messages.
 * @returns The text, or a failure naming the file.
 */
function readChecked(descriptor: number, filePath: string): Procedure<string> {
  if (!fstatSync(descriptor).isFile()) {
    return fail(`${filePath} is not a regular file`, { status: 'EINVAL' });
  }
  const bytes = readCapped(descriptor, filePath);
  if (!bytes.success) return bytes;
  return decode(bytes.data, filePath);
}

/**
 * Reads an open descriptor, turning a thrown read into a failure.
 * @param descriptor - Descriptor opened with {@link CONFIG_READ_FLAGS}.
 * @param filePath - The file, for failure messages.
 * @returns The text, or a failure naming the file.
 */
function readGuarded(descriptor: number, filePath: string): Procedure<string> {
  try {
    return readChecked(descriptor, filePath);
  } catch (error: unknown) {
    return unreadable(filePath, error);
  }
}

/**
 * Closes a descriptor, reporting a refused close by its errno.
 * @param descriptor - Descriptor opened with {@link CONFIG_READ_FLAGS}.
 * @param filePath - The file, for the failure message.
 * @returns Success, or a failure carrying the errno.
 */
function closeConfig(descriptor: number, filePath: string): Procedure<true> {
  try {
    closeSync(descriptor);
    return succeed(true);
  } catch (error: unknown) {
    return unreadable(filePath, error);
  }
}

/**
 * Reads an open descriptor and always closes it.
 *
 * <p>A refused close fails the read, as it does in the storage port, but an
 * earlier failure stays the one reported: it is the reason the read stopped.
 * @param descriptor - Descriptor opened with {@link CONFIG_READ_FLAGS}.
 * @param filePath - The file, for failure messages.
 * @returns The text, or a failure naming the file.
 */
function readThenClose(descriptor: number, filePath: string): Procedure<string> {
  const text = readGuarded(descriptor, filePath);
  const closed = closeConfig(descriptor, filePath);
  if (!text.success || closed.success) return text;
  return closed;
}

/**
 * Opens a config file for reading.
 * @param filePath - Absolute path to the file.
 * @returns The descriptor, or a failure carrying the errno.
 */
function openConfig(filePath: string): Procedure<number> {
  try {
    const descriptor = openSync(filePath, CONFIG_READ_FLAGS);
    return succeed(descriptor);
  } catch (error: unknown) {
    return unreadable(filePath, error);
  }
}

/**
 * Reads a config file as UTF-8 text.
 * @param filePath - Absolute path to the file.
 * @returns The text, or a failure naming the file (never its contents) with
 *   the errno in `status`; `ENOENT` means the file is absent.
 */
export default function readConfigText(filePath: string): Procedure<string> {
  const opened = openConfig(filePath);
  if (!opened.success) return opened;
  return readThenClose(opened.data, filePath);
}
