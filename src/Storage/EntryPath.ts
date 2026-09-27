/**
 * The path of an entry directly inside a directory, built without `join`.
 *
 * <p>`join` normalises, and normalising collapses `link/..` lexically. When a
 * symlink comes before the `..`, the OS resolves it from the link's target, so
 * the two name different directories. A listing read from one directory then
 * reports its entries in the other: a sweep deletes in a directory it never
 * listed, and the OTP store writes requests where its own listing never looks.
 * Keeping the directory as given lets the OS resolve both the same way.
 * @module
 */

import { sep } from 'node:path';

/**
 * Builds the path of an entry directly inside a directory.
 * @param directory - A directory path, exactly as configured or listed.
 * @param name - The entry's name, a single path segment.
 * @returns The directory, one separator, then the name.
 */
export default function entryPath(directory: string, name: string): string {
  const hasSeparator = directory.endsWith('/') || directory.endsWith(sep);
  return hasSeparator ? `${directory}${name}` : `${directory}${sep}${name}`;
}
