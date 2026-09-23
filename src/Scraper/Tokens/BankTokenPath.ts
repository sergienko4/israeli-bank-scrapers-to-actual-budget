/**
 * Resolves the durable bank-token store path.
 *
 * <p>The long-term tokens API-direct banks mint are runtime state, not
 * configuration: the importer mounts its config directory read-only and the
 * portal is its only writer, so a token captured mid-scrape has nowhere to go
 * in `config.json`. It lives on the read-write data volume beside the other
 * runtime secrets (`app-tokens.json`, `otp-settings.json`).
 * `BANK_TOKENS_PATH` overrides the default so a host deployment can point the
 * importer at its own location.
 */

import { basename, dirname, isAbsolute, parse, sep } from 'node:path';

import ConfigurationError from '../../Errors/ConfigurationError.js';

/** Default durable bank-token store path inside the container image. */
export const DEFAULT_BANK_TOKENS_PATH = '/app/data/bank-tokens.json';

/** The one segment that lexical path handling and the OS can resolve apart. */
const PARENT_SEGMENT = '..';

/** A Windows `\\?\` or `\\.\` prefix, in either slash direction. */
const DEVICE_PREFIX = /^[/\\]{2}[.?][/\\]/u;

/** Whether `node:path` follows Windows rules on this host. */
const isWindows = sep === '\\';

/** One way an override can be unusable, and what the operator is told. */
interface IPathRule {
  readonly isBroken: (filePath: string) => boolean;
  readonly message: string;
}

/**
 * Tells whether a path fails to pin one location regardless of where the
 * process started.
 *
 * <p>A relative path resolves against the working directory. On Windows a
 * path rooted at a bare separator, such as `\data\x.json`, counts as absolute
 * to `node:path` yet resolves against the current drive, so it has the same
 * flaw; its root is the lone separator.
 * @param filePath - Trimmed override to inspect.
 * @returns True when the path is relative or drive-relative.
 */
function isNotFullyQualified(filePath: string): boolean {
  if (!isAbsolute(filePath)) return true;
  return isWindows && parse(filePath).root.length === 1;
}

/**
 * Tells whether a Windows path carries a device prefix.
 *
 * <p>After `\\?\` Windows skips its usual path cleanup, so `.` and empty
 * segments reach the disk as literal names while `join` collapses them, and
 * the store would stage and sweep in different places. `\\.\` addresses
 * devices rather than files. On POSIX `?` and `.` are ordinary names.
 * @param filePath - Absolute override to inspect.
 * @returns True when the path starts with a Windows device prefix.
 */
function hasDevicePrefix(filePath: string): boolean {
  return isWindows && DEVICE_PREFIX.test(filePath);
}

/**
 * Tells whether any segment of a path is `..`.
 *
 * <p>Behind a symlink the OS resolves `..` from the link's target, while
 * `join` and `normalize` drop the link lexically. The store would then write
 * in one directory and sweep another, so abandoned staged tokens would never
 * be removed. Windows accepts `/` as a separator as well as `\`, so a path is
 * split on both; on POSIX the second split is on `/` again and changes nothing.
 * @param filePath - Absolute path to inspect.
 * @returns True when a segment is exactly `..`.
 */
function hasParentSegment(filePath: string): boolean {
  const segments = filePath.split('/').flatMap((part) => part.split(sep));
  return segments.includes(PARENT_SEGMENT);
}

/**
 * Tells whether a path can only name a directory, whatever exists on disk.
 *
 * <p>A trailing separator, a root, or a final `.` segment all name a
 * directory. The store stages its file beside the one it names, so such a path
 * could never be written, and the only symptom would be a warning on every
 * run. Rejecting it at startup names the mistake instead. A root is recognised
 * as its own parent, which also covers a Windows share root such as
 * `\\server\share` that carries no trailing separator.
 * @param filePath - Absolute path without a `..` segment.
 * @returns True when the path names a directory.
 */
function namesDirectory(filePath: string): boolean {
  if (filePath.endsWith('/') || filePath.endsWith(sep)) return true;
  if (dirname(filePath) === filePath) return true;
  return basename(filePath) === '.';
}

/** Checks applied in order; each assumes the ones before it passed. */
const PATH_RULES: readonly IPathRule[] = [
  { isBroken: isNotFullyQualified, message: 'BANK_TOKENS_PATH must be an absolute path' },
  {
    isBroken: hasDevicePrefix,
    message: String.raw`BANK_TOKENS_PATH must not use a \\?\ or \\.\ device prefix`,
  },
  { isBroken: hasParentSegment, message: 'BANK_TOKENS_PATH must not contain a ".." segment' },
  { isBroken: namesDirectory, message: 'BANK_TOKENS_PATH must name a file, not a directory' },
];

/**
 * Resolves the absolute path of the durable bank-token store.
 *
 * <p>An unset, empty or whitespace-only override is treated as absent, so a
 * blank environment variable never yields an unusable path. Otherwise the
 * override is returned as written, not normalised, once it passes every
 * check in `PATH_RULES`. Unsafe segments are refused rather than rewritten,
 * because rewriting them is what made lexical and on-disk resolution disagree.
 * Repeated separators and `.` segments resolve the same both ways once device
 * prefixes are refused, so they pass through.
 * @returns The absolute bank-token store path.
 * @throws ConfigurationError naming the first rule the override breaks.
 */
export default function resolveBankTokensPath(): string {
  const override = process.env.BANK_TOKENS_PATH?.trim();
  if (override === undefined || override.length === 0) {
    return DEFAULT_BANK_TOKENS_PATH;
  }
  const broken = PATH_RULES.find((rule) => rule.isBroken(override));
  if (broken !== undefined) throw new ConfigurationError(broken.message);
  return override;
}
