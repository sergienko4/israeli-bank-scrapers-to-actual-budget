/**
 * Ambient type declaration for the override-floor planner so TypeScript tests
 * can import it without `any` leaks. Mirrors the
 * scripts/refresh-lockfile-logic.d.mts precedent.
 */

import type { IAuditAdvisory } from '../config/audit-report.mjs';

/** A strict semver version, split into comparable parts. */
export interface IParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  text: string;
}

/** One comparator of a parsed range, such as `>=2.2.0`. */
export interface IComparator {
  op: '>=' | '<=' | '>' | '<' | '=';
  version: IParsedVersion;
}

/** One locked copy of a package in package-lock.json `packages`. */
export interface ILockedInstance {
  path: string;
  version: IParsedVersion;
  dev: boolean;
}

/** One `packages` entry of package-lock.json; only the fields read here. */
export interface ILockEntry {
  version?: string;
  dev?: boolean;
}

/** The parts of package.json the planner reads. */
export interface IPlannerManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  overrides?: Record<string, string | Record<string, unknown>>;
  [field: string]: unknown;
}

/** Everything the planner rules read. */
export interface IPlannerInput {
  /** Unaccepted in-scope advisories, as classifyAdvisories returns them. */
  violations: ReadonlyArray<{ ghsa: string; package: string }>;
  /** Every advisory the audit reported, accepted or not. */
  advisories: readonly IAuditAdvisory[];
  manifest: IPlannerManifest;
  lockPackages: Record<string, ILockEntry>;
  /** Package name → (version → ISO-8601 publish time), from `npm view <pkg> time`. */
  publishTimes: Record<string, Record<string, string>>;
  /** ISO-8601 UTC instant the age rule measures against. */
  now: string;
  minReleaseAgeDays: number;
}

/** How a floor relates to the locked line and the release-age window. */
export type FloorKind = 'in-line' | 'fresh' | 'breaking-line' | 'breaking-line-fresh';

/** One override the planner wants to write. */
export interface IPlannedFloor {
  package: string;
  /** The override text: `^x.y.z`, or `>=x.y.z` when raising an existing `>=` override. */
  floor: string;
  /** The override it replaces, or null when none existed. */
  from: string | null;
  ghsas: string[];
  kind: FloorKind;
  /** True when the floor is younger than the release-age window and must be exempted from it. */
  excludeFromAge: boolean;
}

/** Why the planner refused to floor a package. */
export type RejectionReason =
  | 'direct-dependency'
  | 'not-in-lockfile'
  | 'multiple-lines'
  | 'unparseable-range'
  | 'missing-publish-times'
  | 'no-fixed-release'
  | 'unsupported-override'
  | 'override-already-satisfies'
  | 'floor-ineffective';

/** One package the planner refused to floor. */
export interface IRejection {
  package: string;
  ghsas: string[];
  reason: RejectionReason;
}

/** The planner's verdict for one audit. */
export interface IFloorPlan {
  floors: IPlannedFloor[];
  rejections: IRejection[];
  requiresReview: boolean;
}

/** The verdict of {@link verifyOverrideOnlyChange}. */
export type IManifestVerdict = { ok: true } | { ok: false; reason: string };

/** A lockfile, reduced to its `packages` map. */
export interface ILockfile {
  packages?: Record<string, ILockEntry>;
}

/** Parses a strict semver version without build metadata. */
export function parseVersion(text: unknown): IParsedVersion | null;

/** Orders two parsed versions per semver §11. */
export function compareVersions(a: IParsedVersion, b: IParsedVersion): number;

/** Parses a vulnerable range in the narrow npm-audit grammar. */
export function parseRange(text: string | null): IComparator[][] | null;

/** Reports whether a version lies inside a parsed range. */
export function satisfies(version: IParsedVersion, range: IComparator[][]): boolean;

/** Names the caret line a version belongs to. */
export function caretLine(version: Pick<IParsedVersion, 'major' | 'minor' | 'patch'>): string;

/** Lists every locked copy of a package. */
export function findLockedInstances(lockPackages: Record<string, ILockEntry>, name: string): ILockedInstance[];

/** Plans an override floor or a typed rejection for every vulnerable package. */
export function planOverrideFloors(input: IPlannerInput): IFloorPlan;

/** Proves a package.json edit touched nothing but the allowed `overrides` keys. */
export function verifyOverrideOnlyChange(
  before: IPlannerManifest,
  after: IPlannerManifest,
  allowedKeys: readonly string[],
): IManifestVerdict;

/** Reports whether two lockfiles lock exactly the same versions at the same paths. */
export function sameLockedVersions(before: ILockfile, after: ILockfile): boolean;

/** Reports whether an override is a plain `^x.y.z` or `>=x.y.z` floor, the only shape a prune may remove. */
export function isFloorOverride(spec: unknown): boolean;

/** Writes planned floors into a manifest, replacing in place and appending new keys. */
export function applyFloors<T extends IPlannerManifest>(
  manifest: T,
  floors: ReadonlyArray<Pick<IPlannedFloor, 'package' | 'floor'>>,
): T;

/** Refuses any npm invocation outside the floor CLI's allow-list. */
export function assertAllowedNpmArgs(args: readonly string[]): void;
