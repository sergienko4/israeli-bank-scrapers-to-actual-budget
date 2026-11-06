/**
 * Ambient type declaration for the audit blockers module so TypeScript tests
 * can import it without `any` leaks. Mirrors the config/audit-policy.d.mts
 * precedent.
 */

/** One record in package-lock.json's `packages` map; only the fields read here. */
export interface ILockPackage {
  /**
   * Present when the package's own name differs from the one in its install path, as for an `npm:` alias.
   * A record whose name differs, or is unreadable, is never counted as the package its path names.
   */
  name?: string;
  version?: string;
  /** True for a symlink to a folder outside node_modules; any value marks the record as not installed. */
  link?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** package-lock.json's `packages` map, keyed by install path (`''` is the root). */
export type LockPackages = Readonly<Record<string, ILockPackage>>;

/** The opt-in an accepted advisory carries to auto-extend past its expiry. */
export interface IAutoExtend {
  /** The first version that fixes the advisory, as plain `MAJOR.MINOR.PATCH`. */
  fixedIn: string;
}

/** Key under which resolveAutoExtensions records the blocking packages. */
export const BLOCKERS: unique symbol;

/** An entry after resolution; auto-extending entries carry their blockers. */
export type ResolvedEntry<T> = T & { readonly [BLOCKERS]?: readonly string[] };

/** Parses a plain `MAJOR.MINOR.PATCH` version. */
export function parseTriple(text: unknown): [number, number, number] | null;

/** Orders two version triples. */
export function compareTriples(left: readonly number[], right: readonly number[]): number;

/** Reports whether a declared range cannot reach the fixed version. */
export function rangeHoldsBelow(range: unknown, fixedIn: unknown): boolean;

/** Reports whether a version lies inside a range; an unreadable range admits nothing. */
export function satisfies(version: readonly number[], range: unknown): boolean;

/** The vulnerable package of an advisory and the range of versions it covers. */
export interface IAdvisoryRange {
  package: string;
  /** npm's vulnerable range, such as `>=7.0.0 <11.0.1`; null when the report has none. */
  range?: string | null;
}

/** An audit advisory as matched to an accepted entry by GHSA ID and package. */
export interface IReportedAdvisory extends IAdvisoryRange {
  ghsa: string;
}

/** Lists the installed packages whose declared range cannot take the fixed version. */
export function findBlockers(advisory: IAdvisoryRange, fixedIn: string, lockPackages: LockPackages): string[];

/** Attaches the current blockers to every entry that opts into auto-extension. */
export function resolveAutoExtensions<T extends { package: string; autoExtend?: IAutoExtend }>(
  entries: readonly T[],
  lockPackages: LockPackages,
  advisories: readonly IReportedAdvisory[],
): Array<ResolvedEntry<T>>;
