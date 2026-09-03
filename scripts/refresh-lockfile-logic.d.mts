/**
 * Ambient type declaration for the lockfile-canonicality module so TypeScript
 * tests can import it without `any` leaks. Mirrors the
 * scripts/release-signal-logic.d.mts precedent.
 */

/** A package whose tarball resolves from outside the public npm registry. */
export interface IForeignRegistryEntry {
  path: string;
  resolved: string;
}

/** A package recorded with an integrity hash weaker than npm's default. */
export interface IWeakIntegrityEntry {
  path: string;
  integrity: string;
}

/** The canonicality verdict and the evidence behind it. */
export interface ILockfileAudit {
  ok: boolean;
  foreignRegistries: IForeignRegistryEntry[];
  weakIntegrities: IWeakIntegrityEntry[];
}

/** The result of rewriting mirror-sourced registry URLs. */
export interface ICanonicalizeResult {
  text: string;
  replaced: number;
}

/**
 * One package whose pinned version moved. `from`/`to` are `undefined` when the
 * package was added or removed rather than re-pinned.
 */
export interface IVersionChange {
  path: string;
  from: string | undefined;
  to: string | undefined;
}

/** What a lockfile refresh changed, and the commit type that change demands. */
export interface IRefreshSummary {
  runtimeChanges: IVersionChange[];
  devChanges: IVersionChange[];
  commitType: 'fix' | 'chore';
  title: string;
  hasChanges: boolean;
}

/** The only registry a tarball in this repository may resolve from. */
export const CANONICAL_REGISTRY: string;

/** Lists every package whose tarball resolves from outside public npm. */
export function findForeignRegistryEntries(lockText: string): IForeignRegistryEntry[];

/** Lists every package recorded with a downgraded integrity hash. */
export function findWeakIntegrities(lockText: string): IWeakIntegrityEntry[];

/** Rewrites every mirror-sourced `resolved` URL back to the public registry. */
export function canonicalizeRegistryUrls(lockText: string): ICanonicalizeResult;

/** Reports what the repair changed, and which part of it stays unverified. */
export function formatRepairSummary(replaced: number): string;

/** Judges a lockfile against both canonicality rules at once. */
export function auditLockfile(lockText: string): ILockfileAudit;

/** Renders the audit verdict as operator-facing console output. */
export function formatLockfileReport(audit: ILockfileAudit): string;

/** Describes what a refresh changed and whether it must ship as a release. */
export function summarizeRefresh(beforeText: string, afterText: string): IRefreshSummary;

/** Renders the pull-request body describing an automated refresh. */
export function formatRefreshBody(summary: IRefreshSummary): string;
