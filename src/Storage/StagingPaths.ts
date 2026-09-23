/**
 * Names for the two paths a commit needs besides the store itself.
 *
 * <p>Both are randomised. A predictable staging name lets another local
 * process plant a symlink there ahead of the write, and a quarantine name
 * built from a timestamp alone collides when two failures land in the same
 * millisecond, silently discarding the first salvage.
 */

import { randomUUID } from 'node:crypto';
import { basename, dirname } from 'node:path';

/** Characters that are illegal or awkward in a filename. */
const UNSAFE_IN_NAMES = /[:.]/g;

/** Suffix every staged file carries, and nothing else does. */
const STAGING_SUFFIX = '.tmp';

/** The shape {@link randomUUID} produces, and the only token accepted. */
const STAGING_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Builds an unpredictable staging path alongside the store.
 * @param filePath - Absolute path of the store.
 * @returns A path no other process can have guessed.
 */
export function stagingPathFor(filePath: string): string {
  const token = randomUUID();
  return `${filePath}.${token}.tmp`;
}

/**
 * Builds a unique path to move a damaged store aside to.
 * @param filePath - Absolute path of the store.
 * @returns A path carrying both the time of failure and a unique suffix.
 */
export function quarantinePathFor(filePath: string): string {
  const moment = new Date(Date.now());
  const iso = moment.toISOString();
  const stamp = iso.replace(UNSAFE_IN_NAMES, '-');
  const token = randomUUID();
  return `${filePath}.quarantined-${stamp}-${token}`;
}

/**
 * Names the directory a store and its staged files share.
 * @param filePath - Absolute path of the store.
 * @returns The containing directory.
 */
export function directoryOf(filePath: string): string {
  return dirname(filePath);
}

/**
 * Reports whether a path is a staging file belonging to one store.
 *
 * <p>Matches the whole grammar {@link stagingPathFor} emits, not just its
 * ends. Testing the ends alone is not enough: a store at `tokens.json` would
 * claim `tokens.json.backup.<uuid>.tmp`, which is the legitimate staging file
 * of a different store called `tokens.json.backup`, and sweep away its
 * credential. Requiring the middle segment to be exactly a UUID makes the
 * prefix unambiguous again.
 *
 * <p>The suffix still matters independently: a quarantined file shares the
 * prefix but is the only copy of salvaged data, and must never be swept.
 *
 * <p>Both sides are reduced to their file name first. The candidates come
 * from a directory listing, which joins and so normalises, while the store
 * path arrives however the operator configured it: a store at
 * `./data/tokens.json` compared as a whole string would match none of its own
 * staged files and sweep nothing, leaving live tokens on disk forever.
 * Normalising the store path instead would be wrong — collapsing `..`
 * lexically can point at a different file when a symlink precedes it — and
 * the candidate is known to sit in the listed directory already.
 * @param filePath - Absolute path of the store.
 * @param candidate - Path found alongside it.
 * @returns True when the candidate is this store's staging file.
 */
export function isStagingPath(filePath: string, candidate: string): boolean {
  const prefix = `${basename(filePath)}.`;
  const name = basename(candidate);
  if (!name.startsWith(prefix)) return false;
  if (!name.endsWith(STAGING_SUFFIX)) return false;
  const token = name.slice(prefix.length, name.length - STAGING_SUFFIX.length);
  return STAGING_TOKEN.test(token);
}
