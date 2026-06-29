/**
 * Single source of truth for the importer config-file path.
 *
 * The importer, scheduler, validator and receipt adapter all read the same
 * config.json; this module centralises the `CONFIG_PATH` env override and the
 * container default so the path is defined in exactly one place. Pointing every
 * reader at a directory-mounted file (e.g. `/app/config/config.json`) lets a
 * read-only importer and a read-write portal share one volume under least
 * privilege — see docs/configuration/portal.md.
 */

/** Default config.json path inside the container image. */
export const DEFAULT_CONFIG_PATH = '/app/config.json';

/**
 * Resolves the importer config.json path from the `CONFIG_PATH` env var,
 * falling back to the container default.
 * @returns Absolute path to config.json (credentials.json is its sibling).
 */
export function resolveConfigPath(): string {
  return process.env.CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
}
