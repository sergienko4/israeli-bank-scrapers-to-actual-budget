/**
 * BankFilterPolicy — single owner of the IMPORT_BANKS CSV semantics.
 *
 * ContextFactory delegates the env-var read here so no pipeline Step ever
 * touches process.env (INV-1 in phase-3 spec).
 */

import type { IBankFilter } from '../Index.js';

/**
 * Process-env-like record type accepted by {@link fromEnv}.
 * Keeps `string | undefined` out of the public function signature while still
 * matching the shape of `process.env`.
 */
export type IProcessEnvLike = Readonly<Record<string, string | undefined>>;

/** Permissive filter that admits every bank name. */
export const ALLOW_ALL: IBankFilter = Object.freeze({
  /**
   * Always returns true regardless of bank name.
   * @returns Constant true.
   */
  matches(): boolean {
    return true;
  },
});

/**
 * Builds an IBankFilter from a CSV string of bank names.
 * @param csv - Comma-separated bank names (whitespace ignored).
 *   Empty string yields ALLOW_ALL.
 * @returns IBankFilter that admits only names present in the CSV.
 */
export function fromCsv(csv: string): IBankFilter {
  if (!csv) return ALLOW_ALL;
  const allowed = parseCsvAllowed(csv);
  if (allowed.size === 0) return ALLOW_ALL;
  return buildAllowedFilter(allowed);
}

/**
 * Parses a CSV string into a deduplicated Set of trimmed non-empty names.
 * @param csv - Raw CSV string.
 * @returns Set of allowed bank names.
 */
function parseCsvAllowed(csv: string): ReadonlySet<string> {
  const tokens = csv.split(',');
  const trimmed = tokens.map(
    (token: string): string => token.trim(),
  );
  const nonEmpty = trimmed.filter(
    (token: string): boolean => token.length > 0,
  );
  return new Set(nonEmpty);
}

/**
 * Builds an IBankFilter that uses Set membership for the lookup.
 * @param allowed - Set of allowed bank names.
 * @returns Frozen IBankFilter.
 */
function buildAllowedFilter(allowed: ReadonlySet<string>): IBankFilter {
  return Object.freeze({
    /**
     * Returns true when the bank name appears in the allowed set.
     * @param bankName - Bank name from config.
     * @returns True if admitted by the filter.
     */
    matches(bankName: string): boolean {
      return allowed.has(bankName);
    },
  });
}

/**
 * Builds an IBankFilter from a process-env-like record.
 * Sole site for reading IMPORT_BANKS — invoked at the composition root.
 * @param env - Map of environment variables (typically process.env).
 * @returns IBankFilter derived from env.IMPORT_BANKS, or ALLOW_ALL.
 */
export function fromEnv(env: IProcessEnvLike): IBankFilter {
  const csv = env.IMPORT_BANKS;
  if (!csv) return ALLOW_ALL;
  return fromCsv(csv);
}
