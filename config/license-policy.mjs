/**
 * Production-dependency license policy: the allow-list plus the pure SPDX
 * evaluation used by `npm run lint:licenses`.
 *
 * Split out of config/check-licenses.mjs so the policy is unit-testable without
 * spawning the license-compliance CLI, mirroring the
 * scripts/pr-status-logic.cjs precedent.
 *
 * The evaluation deliberately does not delegate to license-compliance's own
 * `--allow` matching. From 4.0.0 that library calls
 * `spdxSatisfies(allowList, [declaredLicense])`, i.e. it passes the declared
 * license as spdx-satisfies' *approved* argument. spdx-satisfies 6 rejects an
 * approved argument that is a conjunction or disjunction
 * ("Approved licenses cannot be AND or OR expressions"), the library swallows
 * the error, and every package declaring a compound license is reported as a
 * violation no matter what the allow-list says — @bufbuild/protobuf, pulled in
 * by @actual-app/api, declares "(Apache-2.0 AND BSD-3-Clause)". Calling
 * spdx-satisfies in the documented direction here restores the intended
 * semantics: an AND expression needs every operand allowed, an OR expression
 * needs any one of them.
 *
 * @see https://github.com/tmorell/license-compliance/blob/main/src/license.ts
 */

import spdxSatisfies from 'spdx-satisfies';

/** SPDX identifiers this project itself may be published under. */
export const ALLOWED_PROJECT_LICENSES = ['MIT'];

/**
 * SPDX identifiers permitted for production dependencies.
 *
 * Plain identifiers only: spdx-satisfies requires the approved list to be free
 * of AND/OR expressions, and compound declarations are resolved against this
 * list instead of being enumerated. "(MIT OR WTFPL)" passes because MIT is
 * listed; "(Apache-2.0 AND BSD-3-Clause)" passes because both operands are.
 */
export const ALLOWED_DEPENDENCY_LICENSES = [
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'Python-2.0',
  'MPL-2.0',
  'AGPL-3.0-or-later',
  'GPL-3.0-only',
  'Unlicense',
];

/**
 * Packages excluded by name. Use sparingly; document the reason for each entry.
 */
export const EXCLUDED_PACKAGES = [
  // absurd-sql ships under MIT per its source repo but its package.json lacks
  // a `license` field, so license-compliance reports UNKNOWN. Pulled in via
  // @actual-app/core. https://github.com/jlongster/absurd-sql
  'absurd-sql',
];

/**
 * Reports whether a package is exempt from the license gate by name.
 *
 * @param {string | undefined} name - Package name as reported by license-compliance.
 * @param {readonly string[]} [excluded] - Exempt package names.
 * @returns {boolean} True when the package is exempt.
 */
export function isPackageExcluded(name, excluded = EXCLUDED_PACKAGES) {
  return typeof name === 'string' && excluded.includes(name);
}

/**
 * Reports whether a declared SPDX expression is satisfied by the allow-list.
 *
 * Unparseable values — license-compliance emits `UNKNOWN` for a missing
 * `license` field and `CUSTOM` for `SEE LICENSE IN ...` — are never allowed, so
 * an undeclared license fails the gate instead of passing silently.
 *
 * @param {string | undefined} license - Declared SPDX expression.
 * @param {readonly string[]} [allowed] - Allowed plain SPDX identifiers.
 * @returns {boolean} True when the expression is satisfied by the allow-list.
 */
export function isLicenseAllowed(license, allowed = ALLOWED_DEPENDENCY_LICENSES) {
  if (typeof license !== 'string' || license.trim() === '') return false;
  try {
    return spdxSatisfies(license, [...allowed]);
  } catch {
    return false;
  }
}

/**
 * Selects the packages that violate the license policy.
 *
 * @param {ReadonlyArray<{ name?: string, version?: string, license?: string }>} packages -
 *   Production packages as reported by `license-compliance --format json`.
 * @param {{ allowed?: readonly string[], excluded?: readonly string[] }} [policy] -
 *   Policy overrides; defaults to this module's allow- and exclude-lists.
 * @returns {Array<{ name?: string, version?: string, license?: string }>} The violating packages.
 */
export function findLicenseViolations(packages, policy = {}) {
  const allowed = policy.allowed ?? ALLOWED_DEPENDENCY_LICENSES;
  const excluded = policy.excluded ?? EXCLUDED_PACKAGES;
  return [...(packages ?? [])].filter(
    (pkg) => !isPackageExcluded(pkg?.name, excluded) && !isLicenseAllowed(pkg?.license, allowed),
  );
}
