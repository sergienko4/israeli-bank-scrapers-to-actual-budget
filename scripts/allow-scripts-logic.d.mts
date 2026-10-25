/**
 * Ambient type declaration for the install-script allowlist policy so
 * TypeScript tests can import it without `any` leaks. Mirrors the
 * scripts/release-signal-logic.d.mts precedent.
 */

/** The lockfile fields the policy reads for one installed package. */
export interface ILockfilePackage {
  version?: string;
  hasInstallScript?: boolean;
  optional?: boolean;
}

/** The slice of package-lock.json the policy reads. */
export interface ILockfile {
  packages?: Record<string, ILockfilePackage>;
}

/** One approved version replaced by one unapproved version of the same package. */
export interface IStalePin {
  name: string;
  version: string;
  was: string;
}

/** A version that runs an install script but is not approved. */
export interface IMissingPin {
  name: string;
  version: string;
}

/** An approved version the tree no longer runs a script for. */
export interface IOrphanPin {
  name: string;
  was: string;
}

/** Every difference between the allowlist and the tree. */
export interface IPinFindings {
  stale: IStalePin[];
  missing: IMissingPin[];
  orphan: IOrphanPin[];
}

export function approvedPins(allowScripts: Record<string, unknown> | undefined): Set<string>;

export function requiredPins(lockfile: ILockfile): Set<string>;

export function diffPins(required: Set<string>, current: Set<string>): IPinFindings;

export function rebuildAllowScripts(
  allowScripts: Record<string, boolean> | undefined,
  required: Set<string>,
  stale: IStalePin[],
): Record<string, boolean>;
