/**
 * Finds the installed packages that hold a dependency below its fixed version.
 *
 * An accepted advisory in config/audit-policy.mjs may opt into auto-extension
 * with `autoExtend: { fixedIn }`. Such an entry keeps working past its
 * `expires` date only while some package in the committed lockfile declares a
 * range for the vulnerable dependency that cannot reach `fixedIn`, and the
 * copy that package resolves is still below `fixedIn`, inside the advisory's
 * vulnerable range, and inside the range the package declares: until that
 * changes, the fix cannot be installed without breaking that package. This
 * module answers "who still blocks the fix?" from package-lock.json and the
 * advisory ranges of the audit report alone.
 *
 * Range parsing is deliberately narrow. Only comparators made of an optional
 * operator and a plain `MAJOR.MINOR.PATCH` version are understood. Anything
 * else (x-ranges, hyphen ranges, prereleases, `*`, dist-tags) is treated as
 * not holding the dependency back, so a range this module cannot read never
 * extends an acceptance: a misreading fails closed into a build failure, not
 * into a silently prolonged waiver.
 *
 * Pure: no I/O, no clock, no imports.
 */

/**
 * Dependency maps of a lockfile record that can hold a package back, in the
 * order npm reads them: an optional dependency overrides a regular one, which
 * overrides a peer.
 */
const DEPENDENCY_FIELDS = ['optionalDependencies', 'dependencies', 'peerDependencies'];

/** Lockfile path prefix of every top-level installed package. */
const NODE_MODULES = 'node_modules/';

/** Lockfile path segment between a package and the packages nested in it. */
const NESTED = '/node_modules/';

/** A plain version with no operator, prerelease, build metadata, or leading zeros. */
const PLAIN_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** One comparator: an optional operator followed by a plain version. */
const COMPARATOR = /^(\^|~|<=|<|>=|>|=)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Key under which {@link resolveAutoExtensions} records the blocking packages.
 *
 * A symbol rather than a string so that no data written into the policy file
 * can forge it: a `blockers` property on an entry is ignored.
 */
export const BLOCKERS = Symbol('blockers');

/**
 * Converts the three matched components of a version into numbers.
 *
 * @param {readonly string[]} parts The major, minor, and patch digits.
 * @returns {[number, number, number] | null} The version triple, or null when a
 *   component is too large to compare exactly.
 */
function toTriple(parts) {
  const triple = parts.map(part => Number(part));
  return triple.every(component => Number.isSafeInteger(component)) ? triple : null;
}

/**
 * Parses a plain `MAJOR.MINOR.PATCH` version.
 *
 * @param {unknown} text Candidate version.
 * @returns {[number, number, number] | null} The version triple, or null when the text is anything else.
 */
export function parseTriple(text) {
  if (typeof text !== 'string') return null;
  const match = PLAIN_VERSION.exec(text);
  return match ? toTriple(match.slice(1)) : null;
}

/**
 * Orders two version triples.
 *
 * @param {readonly number[]} left First version triple.
 * @param {readonly number[]} right Second version triple.
 * @returns {number} Negative when left is lower, positive when higher, zero when equal.
 */
export function compareTriples(left, right) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

/**
 * Returns the exclusive ceiling of a caret range, which tightens below 1.0.0.
 *
 * @param {readonly number[]} version The version after the caret.
 * @returns {number[]} The first version the caret range no longer admits.
 */
function caretCeiling([major, minor, patch]) {
  if (major > 0) return [major + 1, 0, 0];
  if (minor > 0) return [0, minor + 1, 0];
  return [0, 0, patch + 1];
}

/**
 * Upper bound each operator puts on a range, keyed by operator.
 *
 * `null` means the comparator sets no upper bound. A missing operator is an
 * exact version, which npm treats like `=`.
 */
const UPPER_BOUNDS = {
  '^': version => ({ version: caretCeiling(version), inclusive: false }),
  '~': ([major, minor]) => ({ version: [major, minor + 1, 0], inclusive: false }),
  '<': version => ({ version, inclusive: false }),
  '<=': version => ({ version, inclusive: true }),
  '=': version => ({ version, inclusive: true }),
  '>': () => null,
  '>=': () => null,
};

/**
 * Reads the upper bound a single comparator puts on a range.
 *
 * @param {string} token One whitespace-separated comparator.
 * @returns {{ version: number[], inclusive: boolean } | null | undefined} The bound,
 *   null when the comparator has none, or undefined when it cannot be read.
 */
function comparatorBound(token) {
  const match = COMPARATOR.exec(token);
  const version = match ? toTriple(match.slice(2)) : null;
  return version ? UPPER_BOUNDS[match[1] ?? '='](version) : undefined;
}

/**
 * Reports whether an upper bound shuts out the fixed version.
 *
 * @param {{ version: number[], inclusive: boolean }} bound The range's upper bound.
 * @param {readonly number[]} fixed The fixed version triple.
 * @returns {boolean} True when the bound admits nothing at or above the fixed version.
 */
function boundExcludes(bound, fixed) {
  const order = compareTriples(bound.version, fixed);
  return bound.inclusive ? order < 0 : order <= 0;
}

/**
 * Reports whether one `||` alternative stays below the fixed version.
 *
 * The comparators of an alternative are intersected, so a single comparator
 * capped below the fix caps the whole alternative. An unreadable comparator
 * makes the alternative unreadable, which never counts as holding back.
 *
 * @param {string} alternative Space-separated comparators.
 * @param {readonly number[]} fixed The fixed version triple.
 * @returns {boolean} True when the alternative cannot reach the fixed version.
 */
function alternativeHoldsBelow(alternative, fixed) {
  const bounds = alternative.trim().split(/\s+/).map(comparatorBound);
  if (bounds.some(bound => bound === undefined)) return false;
  return bounds.some(bound => bound !== null && boundExcludes(bound, fixed));
}

/**
 * Reports whether a declared range cannot reach the fixed version.
 *
 * Every `||` alternative must stay below the fix: one alternative that admits
 * it means the dependent could take the fix, so it does not block.
 *
 * @param {unknown} range The range a dependent declares.
 * @param {unknown} fixedIn The first version that fixes the advisory.
 * @returns {boolean} True only when the range is readable and cannot take the fix.
 */
export function rangeHoldsBelow(range, fixedIn) {
  const fixed = parseTriple(fixedIn);
  if (typeof range !== 'string' || fixed === null) return false;
  return range.split('||').every(alternative => alternativeHoldsBelow(alternative, fixed));
}

/**
 * Test each operator applies to a version, keyed by operator.
 *
 * Caret and tilde admit their npm lower and upper bounds. A missing operator
 * is an exact version, which npm treats like `=`.
 */
const COMPARATOR_TESTS = {
  '^': (version, bound) => compareTriples(version, bound) >= 0 && compareTriples(version, caretCeiling(bound)) < 0,
  '~': (version, bound) =>
    compareTriples(version, bound) >= 0 && compareTriples(version, [bound[0], bound[1] + 1, 0]) < 0,
  '<': (version, bound) => compareTriples(version, bound) < 0,
  '<=': (version, bound) => compareTriples(version, bound) <= 0,
  '=': (version, bound) => compareTriples(version, bound) === 0,
  '>': (version, bound) => compareTriples(version, bound) > 0,
  '>=': (version, bound) => compareTriples(version, bound) >= 0,
};

/**
 * Reads one comparator into a test of a version.
 *
 * @param {string} token One whitespace-separated comparator.
 * @returns {((version: readonly number[]) => boolean) | undefined} The test,
 *   or undefined when the comparator cannot be read.
 */
function comparatorTest(token) {
  const match = COMPARATOR.exec(token);
  const bound = match ? toTriple(match.slice(2)) : null;
  if (bound === null) return undefined;
  const test = COMPARATOR_TESTS[match[1] ?? '='];
  return version => test(version, bound);
}

/**
 * Reports whether a version lies inside a range.
 *
 * Reads the same narrow grammar as {@link rangeHoldsBelow}. One unreadable
 * comparator makes the whole range unreadable, and an unreadable range admits
 * nothing, so a range this module cannot read never marks a copy as affected.
 *
 * @param {readonly number[]} version The version triple.
 * @param {unknown} range The range, such as an advisory's vulnerable range.
 * @returns {boolean} True only when the range is readable and one `||` alternative admits the version.
 */
export function satisfies(version, range) {
  if (typeof range !== 'string') return false;
  const alternatives = range.split('||').map(alternative => alternative.trim().split(/\s+/).map(comparatorTest));
  if (alternatives.some(tests => tests.includes(undefined))) return false;
  return alternatives.some(tests => tests.every(test => test(version)));
}

/**
 * Derives the package name from a lockfile install path under `node_modules/`.
 *
 * @param {string} key Install path such as `node_modules/a/node_modules/@s/b`.
 * @returns {string} The name after the last `node_modules/` segment.
 */
function packageNameFromKey(key) {
  const index = key.lastIndexOf(NESTED);
  return index === -1 ? key.slice(NODE_MODULES.length) : key.slice(index + NESTED.length);
}

/**
 * Returns the install path of the package that a lockfile path is nested in.
 *
 * @param {string} key Install path such as `node_modules/a/node_modules/@s/b`.
 * @returns {string} The enclosing package's path, or `''` for a top-level package.
 */
function enclosingPath(key) {
  const index = key.lastIndexOf(NESTED);
  return index === -1 ? '' : key.slice(0, index);
}

/**
 * Reports whether a lockfile record is an installed package rather than a link or a malformed entry.
 *
 * Any `link` key marks a record as not installed, whatever its value: npm
 * writes the key only on links, so another value means a damaged lockfile,
 * which must never extend an acceptance.
 *
 * @param {unknown} record One lockfile `packages` record.
 * @returns {boolean} True when the record has a version and no `link` key.
 */
function isInstalled(record) {
  return typeof record?.version === 'string' && !Object.hasOwn(record, 'link');
}

/**
 * Reports whether a dependency map declares a package as its own entry.
 *
 * @param {unknown} map One dependency map of a lockfile record.
 * @param {string} name The dependency.
 * @returns {boolean} True when the map is an object with its own entry for the package.
 */
function declares(map, name) {
  return typeof map === 'object' && map !== null && Object.hasOwn(map, name);
}

/**
 * Reads the range that a lockfile record declares for a package, in npm's precedence order.
 *
 * @param {object} record One lockfile `packages` record.
 * @param {string} name The dependency.
 * @returns {unknown} The declared range, or undefined when no dependency map declares the package.
 */
function declaredRange(record, name) {
  const field = DEPENDENCY_FIELDS.find(candidate => declares(record[candidate], name));
  return field === undefined ? undefined : record[field][name];
}

/**
 * Finds the copy of the package that an installed record resolves, the way Node does.
 *
 * Looks in the record's own `node_modules` first, then in each enclosing
 * `node_modules` up to the top level. The nearest path present in the
 * lockfile wins, even when its record is malformed, so a damaged lockfile
 * never extends an acceptance.
 *
 * @param {string} key The dependent's install path, or `''` for the top level.
 * @param {{ name: string, lockPackages: Record<string, unknown> }} query The package and the lockfile.
 * @returns {unknown} The nearest record for the package, or undefined when no copy is installed.
 */
function resolveCopy(key, query) {
  const path = key === '' ? `${NODE_MODULES}${query.name}` : `${key}${NESTED}${query.name}`;
  if (Object.hasOwn(query.lockPackages, path)) return query.lockPackages[path];
  return key === '' ? undefined : resolveCopy(enclosingPath(key), query);
}

/**
 * Reports whether a resolved copy is still vulnerable and was placed by the dependent's own range.
 *
 * The copy must be installed, below the fix, and inside the advisory's
 * vulnerable range. It must also lie inside the range the dependent declares:
 * a copy outside it was placed by something else, such as an override this
 * repository controls, so it proves nothing about the dependent.
 *
 * @param {unknown} record The resolved lockfile record.
 * @param {unknown} declared The range the dependent declares.
 * @param {{ fixed: number[], range: unknown }} query The fixed version triple and the advisory range.
 * @returns {boolean} True only for an installed, plain-version copy that meets every condition.
 */
function isAffectedCopy(record, declared, query) {
  const version = isInstalled(record) ? parseTriple(record.version) : null;
  if (version === null || compareTriples(version, query.fixed) >= 0) return false;
  return satisfies(version, query.range) && satisfies(version, declared);
}

/**
 * Reports whether one lockfile record blocks the fix.
 *
 * @param {{ name: string, fixedIn: string, fixed: number[] | null, range: unknown, lockPackages: Record<string, unknown> }} query
 *   The vulnerable package, its fix, its advisory range, and the lockfile.
 * @param {string} key The record's install path.
 * @param {unknown} record The lockfile record.
 * @returns {boolean} True when an installed package pins the affected copy it resolves below the fix.
 */
function holdsBack(query, key, record) {
  if (!key.startsWith(NODE_MODULES) || !isInstalled(record)) return false;
  const declared = declaredRange(record, query.name);
  if (!rangeHoldsBelow(declared, query.fixedIn)) return false;
  return isAffectedCopy(resolveCopy(key, query), declared, query);
}

/**
 * Lists the installed packages whose declared range cannot take the fixed version.
 *
 * A package counts only while the copy it resolves is installed, still below
 * the fix, inside the advisory's vulnerable range, and inside the package's
 * own declared range: a copy that an override already moved to the fix, one
 * that the advisory does not cover, or one that is not installed at all,
 * blocks nothing. A missing or unreadable advisory range blocks nothing. Only
 * records under `node_modules/` count. The root record and workspace folders
 * are skipped because this repository controls their manifests and can
 * always take the fix itself. Links and records without a version are skipped
 * too.
 *
 * @param {{ package: string, range?: unknown }} advisory The vulnerable package and its vulnerable range.
 * @param {string} fixedIn The first version that fixes the advisory.
 * @param {Record<string, object>} lockPackages The lockfile's `packages` map.
 * @returns {string[]} Sorted, de-duplicated `name@version` labels.
 */
export function findBlockers(advisory, fixedIn, lockPackages) {
  const query = {
    name: advisory.package,
    fixedIn,
    fixed: parseTriple(fixedIn),
    range: advisory.range,
    lockPackages: lockPackages ?? {},
  };
  const blockers = new Set();
  for (const [key, record] of Object.entries(query.lockPackages)) {
    if (holdsBack(query, key, record)) blockers.add(`${packageNameFromKey(key)}@${record.version}`);
  }
  return [...blockers].sort();
}

/**
 * Attaches the current blockers to every entry that opts into auto-extension.
 *
 * Returns new objects and leaves the input untouched. An entry without a
 * readable `autoExtend.fixedIn` is returned as-is; the policy rejects it. An
 * entry whose advisory the audit no longer reports gets no blockers, because
 * no vulnerable range is left to check a copy against.
 *
 * @param {ReadonlyArray<object>} entries Accepted-advisory entries.
 * @param {Record<string, object>} lockPackages The lockfile's `packages` map.
 * @param {ReadonlyArray<{ ghsa: string, package: string, range?: unknown }>} advisories
 *   The audit's advisories, matched to an entry by GHSA ID and package.
 * @returns {object[]} The entries, auto-extending ones carrying {@link BLOCKERS}.
 */
export function resolveAutoExtensions(entries, lockPackages, advisories) {
  return entries.map(entry => {
    const fixedIn = entry?.autoExtend?.fixedIn;
    if (parseTriple(fixedIn) === null) return entry;
    const advisory = advisories?.find(item => item?.ghsa === entry.ghsa && item?.package === entry.package);
    return { ...entry, [BLOCKERS]: advisory ? findBlockers(advisory, fixedIn, lockPackages) : [] };
  });
}
