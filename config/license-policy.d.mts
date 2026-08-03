/**
 * Ambient type declaration for the license policy module so TypeScript tests
 * can import it without `any` leaks. Mirrors the
 * scripts/render-readme-meta.d.mts precedent.
 */

/** A production package as reported by `license-compliance --format json`. */
export interface ILicenseReportPackage {
  name?: string;
  version?: string;
  license?: string;
}

/** Allow- and exclude-list overrides for {@link findLicenseViolations}. */
export interface ILicensePolicyOverrides {
  allowed?: readonly string[];
  excluded?: readonly string[];
}

/** SPDX identifiers this project itself may be published under. */
export const ALLOWED_PROJECT_LICENSES: readonly string[];

/** SPDX identifiers permitted for production dependencies. */
export const ALLOWED_DEPENDENCY_LICENSES: readonly string[];

/** Packages exempt from the dependency license gate, by name. */
export const EXCLUDED_PACKAGES: readonly string[];

/** Reports whether a package is exempt from the license gate by name. */
export function isPackageExcluded(
  name: string | undefined,
  excluded?: readonly string[],
): boolean;

/** Reports whether a declared SPDX expression is satisfied by the allow-list. */
export function isLicenseAllowed(
  license: string | undefined,
  allowed?: readonly string[],
): boolean;

/** Selects the packages that violate the license policy. */
export function findLicenseViolations(
  packages: readonly ILicenseReportPackage[] | undefined,
  policy?: ILicensePolicyOverrides,
): ILicenseReportPackage[];
