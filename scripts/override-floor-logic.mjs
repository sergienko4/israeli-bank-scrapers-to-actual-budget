/**
 * Pure policy for raising `overrides` floors when an advisory sits behind an
 * exact pin that neither Dependabot nor `npm update` can cross.
 *
 * Given the audit's unaccepted advisories, the manifest, the lockfile and npm's
 * publish times, it returns one planned floor or one typed rejection per
 * vulnerable package. It never reads files, the clock or the network: the CLI
 * (scripts/plan-override-floors.mjs) gathers every input, and ADR-0003 records
 * why each rule below exists.
 *
 * Rules, evaluated per package in order (see the ADR for the rationale):
 * R1 a declared dependency is Dependabot's job, not an override's;
 * R2 the locked copies an advisory reaches must sit on one caret line, and
 *    every other copy must satisfy the override: sit on the floor's caret
 *    line under `^`, or not below the floor under `>=`;
 * R3 every advisory range for the package must parse in the narrow grammar;
 * R4 npm must have reported publish times;
 * R5 pick the lowest fixed version, preferring same-line and aged releases;
 * R6 an existing override keeps its operator and is only ever raised;
 * R7 anything other than an aged same-line caret floor needs human review.
 */

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const COMPARATOR = /^(>=|<=|>|<|=)?(.+)$/;
const SIMPLE_OVERRIDE = /^(\^|>=)(\d+\.\d+\.\d+)$/;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const DAY_MS = 86_400_000;

/** Which comparison results satisfy each comparator operator. */
const OPERATOR_HOLDS = {
  '>=': order => order >= 0,
  '<=': order => order <= 0,
  '>': order => order > 0,
  '<': order => order < 0,
  '=': order => order === 0,
};

/**
 * Parses a strict semver version without build metadata.
 *
 * @param {string} text The version text.
 * @returns {{ major: number, minor: number, patch: number, prerelease: string[], text: string } | null} The version, or null.
 */
export function parseVersion(text) {
  const match = VERSION.exec(typeof text === 'string' ? text : '');
  if (match === null) return null;
  const [, major, minor, patch, pre] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch), prerelease: pre ? pre.split('.') : [], text };
}

/**
 * Orders two prerelease identifiers per semver §11.4.
 *
 * @param {string} a The left identifier.
 * @param {string} b The right identifier.
 * @returns {number} Negative, zero or positive.
 */
function compareIdentifier(a, b) {
  const numericA = /^\d+$/.test(a);
  const numericB = /^\d+$/.test(b);
  if (numericA && numericB) return Number(a) - Number(b);
  if (numericA !== numericB) return numericA ? -1 : 1;
  return a < b ? -1 : Number(a > b);
}

/**
 * Orders two prerelease lists; a release outranks any of its prereleases.
 *
 * @param {string[]} a The left prerelease identifiers.
 * @param {string[]} b The right prerelease identifiers.
 * @returns {number} Negative, zero or positive.
 */
function comparePrerelease(a, b) {
  if (a.length === 0 || b.length === 0) return b.length - a.length;
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const order = compareIdentifier(a[index], b[index]);
    if (order !== 0) return order;
  }
  return a.length - b.length;
}

/**
 * Orders two parsed versions.
 *
 * @param {{ major: number, minor: number, patch: number, prerelease: string[] }} a The left version.
 * @param {{ major: number, minor: number, patch: number, prerelease: string[] }} b The right version.
 * @returns {number} Negative, zero or positive.
 */
export function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * Parses one comparator such as `>=2.2.0`.
 *
 * @param {string} text The comparator text.
 * @returns {{ op: string, version: object } | null} The comparator, or null.
 */
function parseComparator(text) {
  const match = COMPARATOR.exec(text);
  const version = match ? parseVersion(match[2]) : null;
  return version ? { op: match[1] ?? '=', version } : null;
}

/**
 * Parses one comparator set; `*` is the empty set, which matches everything.
 *
 * @param {string} text The set text.
 * @returns {object[] | null} The comparators, or null when any is unparseable.
 */
function parseSet(text) {
  if (text === '*') return [];
  const comparators = text.split(' ').map(parseComparator);
  return comparators.includes(null) ? null : comparators;
}

/**
 * Parses a vulnerable range in the narrow grammar npm audit emits: comparator
 * sets joined by ` || `, each a space-separated list of `op? x.y.z[-pre]`, or
 * `*`. Caret, tilde, x-ranges, hyphen ranges and partial versions are refused,
 * so the planner never guesses at a range it does not fully understand.
 *
 * @param {string | null} text The range text.
 * @returns {object[][] | null} The comparator sets, or null when unparseable.
 */
export function parseRange(text) {
  if (typeof text !== 'string' || text === '') return null;
  const sets = text.split(' || ').map(parseSet);
  return sets.includes(null) ? null : sets;
}

/**
 * Reports whether a version lies inside a parsed range.
 *
 * @param {object} version The parsed version.
 * @param {object[][]} range The parsed range.
 * @returns {boolean} True when any comparator set holds.
 */
export function satisfies(version, range) {
  return range.some(set => set.every(({ op, version: bound }) => OPERATOR_HOLDS[op](compareVersions(version, bound))));
}

/**
 * Names the caret line a version belongs to: two versions share a line
 * exactly when `^low` admits `high`.
 *
 * @param {{ major: number, minor: number, patch: number }} version The parsed version.
 * @returns {string} `M`, `0.m` or `0.0.p`.
 */
export function caretLine({ major, minor, patch }) {
  if (major > 0) return `${major}`;
  if (minor > 0) return `0.${minor}`;
  return `0.0.${patch}`;
}

/**
 * Reports whether a lockfile key installs the named package; a scoped name
 * matches its two segments because the key's last `node_modules/` segment is
 * compared whole.
 *
 * @param {string} path The lockfile `packages` key.
 * @param {string} name The package name.
 * @returns {boolean} True when the key is a copy of the package.
 */
function isPackageKey(path, name) {
  return path.includes('node_modules/') && path.split('node_modules/').pop() === name;
}

/**
 * Lists every locked copy of a package whose version parses.
 *
 * @param {Record<string, { version?: string, dev?: boolean }>} lockPackages The lockfile `packages` map.
 * @param {string} name The package name.
 * @returns {Array<{ path: string, version: object, dev: boolean }>} The copies with a parseable version.
 */
export function findLockedInstances(lockPackages, name) {
  return Object.entries(lockPackages)
    .filter(([path]) => isPackageKey(path, name))
    .map(([path, entry]) => ({ path, version: parseVersion(entry?.version), dev: entry?.dev === true }))
    .filter(instance => instance.version !== null);
}

/**
 * Returns the highest of a list of parsed versions.
 *
 * @param {object[]} versions The parsed versions, non-empty.
 * @returns {object} The highest.
 */
function highest(versions) {
  return versions.reduce((best, version) => (compareVersions(version, best) > 0 ? version : best));
}

/**
 * Returns the lowest of a list of parsed versions.
 *
 * @param {object[]} versions The parsed versions, non-empty.
 * @returns {object} The lowest.
 */
function lowest(versions) {
  return versions.reduce((best, version) => (compareVersions(version, best) < 0 ? version : best));
}

/**
 * R1, R2: refuses declared dependencies, absent packages, and packages with a
 * copy whose version does not parse. An unread copy could sit below the floor
 * or on another line without any rule seeing it.
 *
 * @param {string} name The package name.
 * @param {object} input The planner input.
 * @returns {{ reason: string } | { versions: object[] }} A rejection, or every locked version.
 */
function checkInstances(name, input) {
  if (DEPENDENCY_FIELDS.some(field => Object.hasOwn(input.manifest[field] ?? {}, name))) return { reason: 'direct-dependency' };
  const copies = Object.keys(input.lockPackages).filter(path => isPackageKey(path, name)).length;
  if (copies === 0) return { reason: 'not-in-lockfile' };
  const versions = findLockedInstances(input.lockPackages, name).map(instance => instance.version);
  return versions.length < copies ? { reason: 'unparseable-version' } : { versions };
}

/**
 * R2: requires the copies an advisory reaches to share one caret line, so a
 * single floor can fix them all. A copy no advisory reaches is not part of the
 * question; when none is reached the whole tree is considered.
 *
 * @param {{ versions: object[], ranges: object[][] }} facts What R1 and R3 established.
 * @returns {{ reason: string } | { max: object, scope: object[] }} A rejection, or the highest in-scope version and the scope.
 */
function checkLines({ versions, ranges }) {
  const affected = versions.filter(version => ranges.some(range => satisfies(version, range)));
  const scope = affected.length > 0 ? affected : versions;
  if (new Set(scope.map(caretLine)).size > 1) return { reason: 'multiple-lines' };
  return { max: highest(scope), scope };
}

/**
 * R3: parses every advisory range for the package, accepted or not, because a
 * floor must clear all of them.
 *
 * @param {string} name The package name.
 * @param {object} input The planner input.
 * @returns {{ reason: string } | { ranges: object[][] }} A rejection, or the parsed ranges.
 */
function checkRanges(name, input) {
  const ranges = input.advisories.filter(advisory => advisory.package === name).map(advisory => parseRange(advisory.range));
  return ranges.includes(null) ? { reason: 'unparseable-range' } : { ranges };
}

/**
 * R4: lists the stable versions npm reported a valid publish time for.
 *
 * @param {string} name The package name.
 * @param {object} input The planner input.
 * @returns {{ reason: string } | { published: Array<{ version: object, ms: number }> }} A rejection, or the versions.
 */
function checkPublished(name, input) {
  const published = Object.entries(input.publishTimes[name] ?? {})
    .map(([text, time]) => ({ version: parseVersion(text), ms: Date.parse(time) }))
    .filter(({ version, ms }) => version !== null && version.prerelease.length === 0 && Number.isFinite(ms));
  return published.length === 0 ? { reason: 'missing-publish-times' } : { published };
}

/**
 * R5: picks the lowest fixed version from the first non-empty preference tier.
 *
 * @param {{ max: object, ranges: object[][], published: object[] }} facts What R2–R4 established.
 * @param {object} input The planner input.
 * @returns {{ reason: string } | { version: object, kind: string }} A rejection, or the floor and its kind.
 */
function pickFloor({ max, ranges, published }, input) {
  const cutoff = Date.parse(input.now) - input.minReleaseAgeDays * DAY_MS;
  const candidates = published
    .filter(({ version }) => compareVersions(version, max) >= 0 && !ranges.some(range => satisfies(version, range)))
    .map(({ version, ms }) => ({ version, aged: ms <= cutoff, sameLine: caretLine(version) === caretLine(max) }));
  const tiers = [
    ['in-line', candidate => candidate.sameLine && candidate.aged],
    ['fresh', candidate => candidate.sameLine],
    ['breaking-line', candidate => candidate.aged],
    ['breaking-line-fresh', () => true],
  ];
  for (const [kind, admits] of tiers) {
    const tier = candidates.filter(admits);
    if (tier.length > 0) return { version: lowest(tier.map(candidate => candidate.version)), kind };
  }
  return { reason: 'no-fixed-release' };
}

/**
 * R6: reconciles the floor with any existing override, keeping its operator so
 * an open `>=` floor never gains an upper bound.
 *
 * @param {string} name The package name.
 * @param {object} version The planned floor version.
 * @param {object} input The planner input.
 * @returns {{ reason: string } | { floor: string, from: string | null }} A rejection, or the override text.
 */
function reconcileOverride(name, version, input) {
  const overrides = input.manifest.overrides ?? {};
  if (!Object.hasOwn(overrides, name)) return { floor: `^${version.text}`, from: null };
  const existing = overrides[name];
  const match = typeof existing === 'string' ? SIMPLE_OVERRIDE.exec(existing) : null;
  if (match === null) return { reason: 'unsupported-override' };
  if (compareVersions(parseVersion(match[2]), version) >= 0) return { reason: 'override-already-satisfies' };
  return { floor: `${match[1]}${version.text}`, from: existing };
}

/**
 * Reports whether a locked copy satisfies an override: `>=` admits any
 * version not below it, and `^` admits any version on the floor's caret line,
 * below the floor or above it.
 *
 * Admitting a copy does not pin it. `npm update <pkg>` re-resolves every
 * copy, admitted ones included, to the newest release the override allows:
 * within the copy's caret line under `^`, without an upper bound under `>=`.
 * A copy below a `>=` floor is therefore rejected, because the override would
 * force it onto that unbounded newest release.
 *
 * A prerelease copy is never admitted. The override is always a plain
 * release, and npm ranges skip prereleases of any other release, so the
 * override would move that copy.
 *
 * @param {string} floor The override text, `^x.y.z` or `>=x.y.z`.
 * @param {object} version The parsed locked version.
 * @returns {boolean} True when the copy satisfies the override.
 */
function admitsOverride(floor, version) {
  if (version.prerelease.length > 0) return false;
  const [, operator, text] = SIMPLE_OVERRIDE.exec(floor);
  const bound = parseVersion(text);
  if (operator === '>=') return compareVersions(version, bound) >= 0;
  return caretLine(version) === caretLine(bound);
}

/**
 * R2 guard: an override applies to every copy of the package, so a copy no
 * advisory reaches must already satisfy it, or the override would force that
 * copy across a breaking boundary and no audit would notice. A copy that does
 * satisfy it may still be raised by `npm update`, within its caret line under
 * `^`.
 *
 * @param {{ versions: object[], scope: object[] }} facts What R2 established.
 * @param {{ floor: string, from: string | null }} override The reconciled override.
 * @returns {{ reason: string } | { floor: string, from: string | null }} A rejection, or the override unchanged.
 */
function guardBystanders({ versions, scope }, override) {
  const bystanders = versions.filter(version => !scope.includes(version));
  return bystanders.every(version => admitsOverride(override.floor, version)) ? override : { reason: 'multiple-lines' };
}

/**
 * Plans one package through R1–R6, stopping at the first rejection.
 *
 * @param {string} name The package name.
 * @param {string[]} ghsas The sorted violation GHSAs for the package.
 * @param {object} input The planner input.
 * @returns {{ floor?: object, rejection?: object }} Exactly one of a floor or a rejection.
 */
function planPackage(name, ghsas, input) {
  const instances = checkInstances(name, input);
  const ranges = instances.reason ? instances : checkRanges(name, input);
  const lines = ranges.reason ? ranges : checkLines({ ...instances, ...ranges });
  const published = lines.reason ? lines : checkPublished(name, input);
  const pick = published.reason ? published : pickFloor({ ...lines, ...ranges, ...published }, input);
  const reconciled = pick.reason ? pick : reconcileOverride(name, pick.version, input);
  const override = reconciled.reason ? reconciled : guardBystanders({ ...instances, ...lines }, reconciled);
  if (override.reason) return { rejection: { package: name, ghsas, reason: override.reason } };
  const excludeFromAge = pick.kind === 'fresh' || pick.kind === 'breaking-line-fresh';
  return { floor: { package: name, floor: override.floor, from: override.from, ghsas, kind: pick.kind, excludeFromAge } };
}

/**
 * Groups violation GHSAs by package, both sorted.
 *
 * @param {Array<{ ghsa: string, package: string }>} violations The unaccepted advisories.
 * @returns {Array<[string, string[]]>} Package names with their sorted, unique GHSAs.
 */
function groupViolations(violations) {
  const byPackage = new Map();
  for (const { ghsa, package: name } of violations) {
    byPackage.set(name, (byPackage.get(name) ?? new Set()).add(ghsa));
  }
  return [...byPackage].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, ghsas]) => [name, [...ghsas].sort()]);
}

/**
 * R7: reports whether a plan needs a human. Only an aged same-line caret
 * floor merges unattended; a kept `>=` override admits every later major, so
 * it needs review even when its floor is on the locked line.
 *
 * @param {ReadonlyArray<{ kind: string, floor: string }>} floors The planned floors.
 * @param {ReadonlyArray<object>} rejections The rejections.
 * @returns {boolean} True when any rejection or any floor but an in-line `^` floor exists.
 */
export function needsReview(floors, rejections) {
  return rejections.length > 0 || floors.some(floor => floor.kind !== 'in-line' || !floor.floor.startsWith('^'));
}

/**
 * Plans an override floor or a typed rejection for every vulnerable package.
 *
 * @param {import('./override-floor-logic.d.mts').IPlannerInput} input Everything the rules read.
 * @returns {import('./override-floor-logic.d.mts').IFloorPlan} Floors and rejections, both sorted by package.
 */
export function planOverrideFloors(input) {
  const floors = [];
  const rejections = [];
  for (const [name, ghsas] of groupViolations(input.violations)) {
    const { floor, rejection } = planPackage(name, ghsas, input);
    if (floor) floors.push(floor);
    else rejections.push(rejection);
  }
  return { floors, rejections, requiresReview: needsReview(floors, rejections) };
}

/**
 * Serialises a value with object keys sorted, so equality ignores key order.
 *
 * @param {unknown} value The value.
 * @returns {string} A canonical JSON string.
 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

/**
 * Proves a `package.json` edit touched nothing but the planned `overrides`
 * keys, so an automated refresh can never change a declared dependency, a
 * script or any other field.
 *
 * @param {object} before The committed manifest.
 * @param {object} after The edited manifest.
 * @param {readonly string[]} allowedKeys The override keys the plan may change.
 * @returns {{ ok: true } | { ok: false, reason: string }} The verdict.
 */
export function verifyOverrideOnlyChange(before, after, allowedKeys) {
  const { overrides: oldOverrides = {}, ...oldRest } = before;
  const { overrides: newOverrides = {}, ...newRest } = after;
  if (canonical(oldRest) !== canonical(newRest)) return { ok: false, reason: 'a field outside "overrides" changed' };
  const keys = new Set([...Object.keys(oldOverrides), ...Object.keys(newOverrides)]);
  const stray = [...keys].filter(key => canonical(oldOverrides[key]) !== canonical(newOverrides[key]) && !allowedKeys.includes(key));
  return stray.length === 0 ? { ok: true } : { ok: false, reason: `override(s) changed outside the plan: ${stray.sort().join(', ')}` };
}

/**
 * Reports whether two lockfiles lock exactly the same versions at the same
 * paths, which is the test for an override that no longer does anything.
 *
 * @param {{ packages?: Record<string, { version?: string }> }} before The first lockfile.
 * @param {{ packages?: Record<string, { version?: string }> }} after The second lockfile.
 * @returns {boolean} True when the version maps are identical.
 */
export function sameLockedVersions(before, after) {
  const versions = lock => canonical(Object.fromEntries(Object.entries(lock.packages ?? {}).map(([path, entry]) => [path, entry?.version ?? null])));
  return versions(before) === versions(after);
}

/**
 * Reports whether an override is a plain floor — `^x.y.z` or `>=x.y.z` — the
 * only shape the planner writes and the only shape a prune may remove. An
 * exact pin, a range with an upper bound, a `$dependency` reference or an
 * object can encode a cap or a policy that still matters once it is a no-op
 * today, so those are left for a human.
 *
 * @param {unknown} spec The override value.
 * @returns {boolean} True for a plain floor.
 */
export function isFloorOverride(spec) {
  return typeof spec === 'string' && SIMPLE_OVERRIDE.test(spec);
}

/**
 * Writes planned floors into a manifest: existing keys are replaced in place
 * and new keys are appended, so the diff shows only the floors.
 *
 * @param {object} manifest The parsed `package.json`.
 * @param {ReadonlyArray<{ package: string, floor: string }>} floors The floors to apply.
 * @returns {object} A new manifest with the floors applied.
 */
export function applyFloors(manifest, floors) {
  const overrides = { ...manifest.overrides };
  for (const { package: name, floor } of floors) overrides[name] = floor;
  return { ...manifest, overrides };
}

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const AUDIT_FLAGS = new Set(['--json', '--package-lock-only', '--omit=dev']);
const UPDATE_FLAG = /^--(?:package-lock-only|ignore-scripts|min-release-age=\d+|min-release-age-exclude=(.+))$/;

/**
 * Validates `npm audit` arguments: lockfile-only, JSON, optionally production.
 *
 * @param {string[]} rest The arguments after `audit`.
 * @returns {boolean} True when allowed.
 */
function isAllowedAudit(rest) {
  return rest.includes('--package-lock-only') && rest.every(arg => AUDIT_FLAGS.has(arg));
}

/**
 * Validates `npm view <pkg> time --json`.
 *
 * @param {string[]} rest The arguments after `view`.
 * @returns {boolean} True when allowed.
 */
function isAllowedView(rest) {
  return rest.length === 3 && PACKAGE_NAME.test(rest[0]) && rest[1] === 'time' && rest[2] === '--json';
}

/**
 * Validates one `npm update` argument: a package name, or a known flag whose
 * exclusion target is itself a package name.
 *
 * @param {string} arg The argument.
 * @returns {boolean} True when allowed.
 */
function isAllowedUpdateArg(arg) {
  if (!arg.startsWith('-')) return PACKAGE_NAME.test(arg);
  const match = UPDATE_FLAG.exec(arg);
  return match !== null && (match[1] === undefined || PACKAGE_NAME.test(match[1]));
}

/**
 * Validates `npm update <pkg…>`: lockfile-only, scripts off, age flags only.
 *
 * @param {string[]} rest The arguments after `update`.
 * @returns {boolean} True when allowed.
 */
function isAllowedUpdate(rest) {
  return rest.some(arg => !arg.startsWith('-'))
    && rest.includes('--package-lock-only')
    && rest.includes('--ignore-scripts')
    && rest.every(isAllowedUpdateArg);
}

/** Validators for the only npm subcommands the floor CLI may run. */
const ALLOWED_NPM = { audit: isAllowedAudit, view: isAllowedView, update: isAllowedUpdate };

/**
 * Refuses any npm invocation outside the floor CLI's allow-list, so no code
 * path can install, execute or run lifecycle scripts for a package.
 *
 * @param {readonly string[]} args The npm arguments, subcommand first.
 * @returns {void} Returns only when the invocation is allowed.
 * @throws {Error} When the invocation is not allowed.
 */
export function assertAllowedNpmArgs(args) {
  const [command, ...rest] = args;
  const allowed = Object.hasOwn(ALLOWED_NPM, command) && ALLOWED_NPM[command](rest);
  if (!allowed) throw new Error(`npm ${args.join(' ')} is outside the override-floor allow-list`);
}
