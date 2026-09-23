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

import { isAbsolute, normalize, sep } from 'node:path';

import ConfigurationError from '../../Errors/ConfigurationError.js';

/** Default durable bank-token store path inside the container image. */
export const DEFAULT_BANK_TOKENS_PATH = '/app/data/bank-tokens.json';

/**
 * Resolves the absolute path of the durable bank-token store.
 *
 * <p>An unset, empty or whitespace-only override is treated as absent, so a
 * blank environment variable never yields an unusable path. An override must
 * be absolute: the importer and the portal may run with different working
 * directories, and a relative path would silently resolve to two different
 * files, which presents as a warm start that never warms.
 *
 * <p>The result is normalised so that two spellings of one location cannot
 * become two stores, and so a traversal-laden value is at least visible in
 * logs and errors as the place it actually writes to.
 * @returns The absolute, normalised bank-token store path.
 * @throws ConfigurationError when `BANK_TOKENS_PATH` is set to a relative path.
 */
export default function resolveBankTokensPath(): string {
  const override = process.env.BANK_TOKENS_PATH?.trim();
  if (override === undefined || override.length === 0) {
    return DEFAULT_BANK_TOKENS_PATH;
  }
  if (!isAbsolute(override)) {
    throw new ConfigurationError(
      'BANK_TOKENS_PATH must be an absolute path shared by the portal and importer'
    );
  }
  const normalised = normalize(override);
  return withoutTrailingSeparator(normalised);
}

/**
 * Drops a trailing separator, which names a directory rather than a file.
 *
 * <p>`normalize` keeps one, and everything downstream then reads the value as
 * the directory it looks like: `dirname` returns the parent, so the directory
 * the store is created in is the wrong one, and the staged temp file becomes
 * a hidden sibling that can never be renamed into place. The store could
 * never be written, and the only symptom was a warning on every run.
 *
 * <p>A root is left alone, because its separator is the path rather than a
 * trailing one. Testing that by length holds only for `/`: a Windows root
 * carries a drive letter, and trimming `C:\` to `C:` yields a drive-relative
 * path that resolves against the current directory. Absoluteness is the
 * property that actually matters here, so it is what the loop checks.
 * @param filePath - Normalised absolute path to trim.
 * @returns The path without a trailing separator, still absolute.
 */
function withoutTrailingSeparator(filePath: string): string {
  let trimmed = filePath;
  while (trimmed.endsWith(sep)) {
    const shorter = trimmed.slice(0, -1);
    if (!isAbsolute(shorter)) return trimmed;
    trimmed = shorter;
  }
  return trimmed;
}
