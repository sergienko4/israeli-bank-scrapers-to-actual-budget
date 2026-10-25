/**
 * scripts/allow-scripts-logic.mjs
 *
 * Pure policy behind scripts/check-allow-scripts.mjs: which install-script
 * pins the lockfile requires, how the allowlist differs from them, and how
 * `--fix` rebuilds it. It does no I/O, so the CLI owns reading and writing.
 *
 * Pins are compared as whole `<name>@<version>` keys, never by name alone. One
 * package can sit in the tree at several versions at once — camoufox-js nests
 * better-sqlite3 12.x beneath the 13.x copy @actual-app/api loads — and every
 * version that runs an install script needs a pin of its own. Keyed by name,
 * one copy overwrote the other, so `--fix` moved the nested copy's pin onto
 * the top-level one: the version that needed its script was left unapproved
 * while the gate still passed.
 */

const NODE_MODULES = 'node_modules/';

/**
 * Extracts the package name from a package-lock.json `packages` key.
 *
 * Keys are tree paths, so a nested copy reads
 * `node_modules/a/node_modules/b`; the name is the segment after the final
 * `node_modules/`.
 *
 * @param {string} key lockfile `packages` key
 * @returns {string} the bare package name, scope included
 */
function nameFromLockKey(key) {
  return key.slice(key.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
}

/**
 * Splits an allowlist entry into its package name and pinned version.
 *
 * Scoped names contain a leading `@`, so the separator is the final `@`.
 *
 * @param {string} entry allowlist key such as `@scope/name@1.2.3`
 * @returns {{ name: string, version: string }} the split entry
 */
function splitPin(entry) {
  const at = entry.lastIndexOf('@');
  return { name: entry.slice(0, at), version: entry.slice(at + 1) };
}

/**
 * An exact SemVer 2.0.0 version, as semver.org defines it: no range, tag or
 * wildcard. Letters are spelled out, not matched case-insensitively: with the
 * `u` flag, `i` also folds non-ASCII letters such as `ſ` onto `[a-z]`.
 */
const EXACT_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*))*)?(?:\+[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)?$/u;

/**
 * Tells whether an allowlist key names one package at one exact version.
 * @param {string} pin the allowlist key
 * @returns {boolean} true for `<name>@<exact version>`
 */
function isExactPin(pin) {
  const { name, version } = splitPin(pin);
  return name.length > 0 && EXACT_VERSION.test(version);
}

/**
 * Reads the allowlist's approvals, refusing any entry that is not one.
 *
 * npm also records a denial as `false`, by name or by version. Read as an
 * approval, `--fix` would rewrite it to `true`; a bare name or a range has no
 * exact version to compare, and `--fix` would turn a range into an exact
 * approval nobody reviewed. Each would be misread silently, so it fails instead.
 *
 * @param {Record<string, unknown> | undefined} allowScripts the allowlist
 * @returns {Set<string>} every approved `<name>@<version>`
 * @throws {Error} naming the first entry that is not a pinned approval
 */
export function approvedPins(allowScripts) {
  const entries = Object.entries(allowScripts ?? {});
  const misfit = entries.find(([pin, allowed]) => allowed !== true || !isExactPin(pin));
  if (misfit !== undefined) {
    throw new Error(
      `allowScripts entry "${misfit[0]}": ${JSON.stringify(misfit[1])} is not an approval pinned to ` +
        '<name>@<version> at an exact version; this gate reads only those, so remove or pin it.'
    );
  }
  return new Set(entries.map(([pin]) => pin));
}

/**
 * Derives the pins the installed tree requires.
 *
 * A package needs one exactly when it declares an install script and is not
 * optional; npm tolerates a missing optional package, and `fsevents` is never
 * installed on the CI or container platforms.
 *
 * @param {object} lockfile parsed package-lock.json
 * @returns {Set<string>} every `<name>@<version>` that runs an install script
 */
export function requiredPins(lockfile) {
  const required = new Set();
  for (const [key, entry] of Object.entries(lockfile.packages ?? {})) {
    if (!key.includes(NODE_MODULES) || !entry.hasInstallScript || entry.optional) continue;
    required.add(`${nameFromLockKey(key)}@${entry.version}`);
  }
  return required;
}

/**
 * Groups the pins absent from another set by package name.
 *
 * @param {Iterable<string>} pins the pins to filter
 * @param {Set<string>} other the pins to subtract
 * @returns {Map<string, string[]>} package name to its versions absent from `other`
 */
function versionsAbsentFrom(pins, other) {
  const byName = new Map();
  for (const pin of pins) {
    if (other.has(pin)) continue;
    const { name, version } = splitPin(pin);
    byName.set(name, [...(byName.get(name) ?? []), version]);
  }
  return byName;
}

/**
 * Compares the allowlist against the tree and classifies every difference.
 *
 * A pin is stale only for an unambiguous swap: exactly one approved version of
 * a package left the tree and exactly one unapproved version of it arrived.
 * Any other shape — a second version appearing beside one still approved, or
 * several versions moving at once — is reported as missing plus orphaned,
 * because choosing which copy may run its script is a decision for a human.
 *
 * @param {Set<string>} required pins the tree requires
 * @param {Set<string>} current pins the allowlist declares
 * @returns {{ stale: object[], missing: object[], orphan: object[] }} findings
 */
export function diffPins(required, current) {
  const unapproved = versionsAbsentFrom(required, current);
  const unneeded = versionsAbsentFrom(current, required);
  const stale = [];
  const missing = [];
  for (const [name, versions] of unapproved) {
    const was = unneeded.get(name) ?? [];
    if (versions.length === 1 && was.length === 1) {
      stale.push({ name, version: versions[0], was: was[0] });
      unneeded.delete(name);
    } else missing.push(...versions.map(version => ({ name, version })));
  }
  const orphan = [...unneeded].flatMap(([name, was]) => was.map(old => ({ name, was: old })));
  return { stale, missing, orphan };
}

/**
 * Rebuilds the allowlist, keeping existing key order to minimise the diff.
 *
 * Keeps every pin the tree still requires, swaps each stale pin for its new
 * version in place, and drops the rest. A package absent from the allowlist is
 * deliberately *not* added: approving a dependency that has newly gained an
 * install script is a decision a human has to make, so it is left to fail the
 * gate.
 *
 * @param {Record<string, boolean> | undefined} allowScripts the current allowlist, already
 *   accepted by {@link approvedPins}
 * @param {Set<string>} required pins the tree requires
 * @param {object[]} stale the stale findings from {@link diffPins}
 * @returns {Record<string, boolean>} the corrected allowlist
 */
export function rebuildAllowScripts(allowScripts, required, stale) {
  const rotated = new Map(stale.map(({ name, version, was }) => [`${name}@${was}`, `${name}@${version}`]));
  const rebuilt = {};
  for (const pin of Object.keys(allowScripts ?? {})) {
    if (required.has(pin)) rebuilt[pin] = true;
    else if (rotated.has(pin)) rebuilt[rotated.get(pin)] = true;
  }
  return rebuilt;
}
