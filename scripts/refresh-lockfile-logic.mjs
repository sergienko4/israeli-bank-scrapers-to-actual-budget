/**
 * Lockfile canonicality policy — pure, testable logic behind the guard that
 * keeps `package-lock.json` trustworthy.
 *
 * Background: an `npm install` run behind a corporate mirror does not just
 * change versions. It rewrites every `resolved` URL to point at the mirror
 * (`*.pkgs.visualstudio.com`, `packagefeedproxy.microsoft.io`) and, for a
 * subset of packages, substitutes the legacy `sha1-` checksum npm published
 * years ago for the `sha512-` one npm records today. A lockfile in that state
 * is poisoned in two distinct ways: CI installs would be sourced from a host
 * no one outside the corporate network can reach, and the weaker hash removes
 * the tamper-evidence npm relies on.
 *
 * `.github/workflows/dependency-bump.yml` already states the principle this
 * module enforces — dependency work belongs on a runner, "where npm resolves
 * and verifies the tarball itself rather than trusting a hand-edited
 * lockfile". That is a convention, and a convention cannot detect its own
 * violation. This module is the enforcement half: it answers "is this
 * lockfile something npm produced against the public registry?" so CI can
 * reject the answer "no" mechanically instead of relying on review.
 */

/**
 * The only registry a tarball in this repository may resolve from.
 *
 * The trailing slash is load-bearing. Without it a lookalike host such as
 * `registry.npmjs.org.evil.com` would satisfy a prefix test, which is exactly
 * the substitution this guard exists to catch.
 */
export const CANONICAL_REGISTRY = 'https://registry.npmjs.org/';

/**
 * Integrity algorithms npm still considers tamper-evident.
 *
 * npm emits `sha512-` today. `sha384-` is accepted because npm's own
 * verification treats it as strong; anything else — in practice the `sha1-`
 * hashes the corporate mirror serves — is a downgrade and is rejected.
 */
const STRONG_INTEGRITY_PATTERN = /^sha(?:512|384)-/;

/** Matches the `resolved` values that describe an HTTP registry download. */
const HTTP_URL_PATTERN = /^https?:\/\//;

/** Reports whether a value is a JSON object rather than an array or scalar. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Renders an unknown thrown value as a message without leaking `any`. */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Parses a lockfile document, failing loudly rather than silently passing.
 *
 * A malformed lockfile must not audit clean: that would turn the guard into a
 * rubber stamp on precisely the corrupt input it is meant to stop.
 */
function parseLockfile(lockText) {
  try {
    return JSON.parse(lockText);
  } catch (error) {
    throw new Error(`package-lock.json is not valid JSON: ${errorMessage(error)}`);
  }
}

/** Lists the `[path, entry]` pairs of every package recorded in a lockfile. */
function packageEntries(lockText) {
  const parsed = parseLockfile(lockText);
  const packages = isRecord(parsed) && isRecord(parsed.packages) ? parsed.packages : {};
  return Object.entries(packages).filter(([, entry]) => isRecord(entry));
}

/**
 * Reports whether a `resolved` value points somewhere other than public npm.
 *
 * Only HTTP(S) downloads are judged. `file:`, `link:` and `git+` sources have
 * no registry to be wrong about, so flagging them would be noise.
 */
function isForeignRegistryUrl(resolved) {
  if (typeof resolved !== 'string' || !HTTP_URL_PATTERN.test(resolved)) return false;
  return !resolved.startsWith(CANONICAL_REGISTRY);
}

/** Reports whether an integrity hash is weaker than npm's current default. */
function isWeakIntegrity(integrity) {
  return typeof integrity === 'string' && !STRONG_INTEGRITY_PATTERN.test(integrity);
}

/** Lists every package whose tarball resolves from outside public npm. */
export function findForeignRegistryEntries(lockText) {
  return packageEntries(lockText)
    .filter(([, entry]) => isForeignRegistryUrl(entry.resolved))
    .map(([path, entry]) => ({ path, resolved: entry.resolved }));
}

/** Lists every package recorded with a downgraded integrity hash. */
export function findWeakIntegrities(lockText) {
  return packageEntries(lockText)
    .filter(([, entry]) => isWeakIntegrity(entry.integrity))
    .map(([path, entry]) => ({ path, integrity: entry.integrity }));
}

/**
 * Derives the package name from a lockfile entry path.
 *
 * Nested installs repeat the marker (`node_modules/a/node_modules/b`), so the
 * name is whatever follows the final one. Scoped names keep their `@scope/`
 * prefix because it is part of the registry path.
 */
function packageNameFromPath(entryPath) {
  const marker = 'node_modules/';
  const index = entryPath.lastIndexOf(marker);
  return index === -1 ? entryPath : entryPath.slice(index + marker.length);
}

/**
 * Builds the public-registry URL for a package's tarball.
 *
 * The name is taken from the lockfile entry path rather than parsed out of
 * the mirror URL. Mirrors nest packages under arbitrary prefixes, and a
 * scoped name would be ambiguous to recover from the URL alone; the entry
 * path is unambiguous by construction.
 */
function canonicalUrlFor(entryPath, resolved) {
  const file = resolved.split('?')[0].split('/').pop();
  return `${CANONICAL_REGISTRY}${packageNameFromPath(entryPath)}/-/${file}`;
}

/**
 * Rewrites every mirror-sourced `resolved` URL back to the public registry.
 *
 * The substitution runs over the raw text, not a re-serialised object, so
 * npm's exact formatting survives. Re-serialising would reformat the whole
 * file and bury the real change in tens of thousands of noise lines.
 */
export function canonicalizeRegistryUrls(lockText) {
  let text = lockText;
  let replaced = 0;
  for (const { path, resolved } of findForeignRegistryEntries(lockText)) {
    if (!text.includes(resolved)) continue;
    text = text.split(resolved).join(canonicalUrlFor(path, resolved));
    replaced += 1;
  }
  return { text, replaced };
}

/** Judges a lockfile against both canonicality rules at once. */
export function auditLockfile(lockText) {
  const foreignRegistries = findForeignRegistryEntries(lockText);
  const weakIntegrities = findWeakIntegrities(lockText);
  const ok = foreignRegistries.length === 0 && weakIntegrities.length === 0;
  return { ok, foreignRegistries, weakIntegrities };
}

/**
 * Indexes package versions by lockfile path, restricted to one dependency kind.
 *
 * The root entry is skipped: it records the project itself, so its `version`
 * tracks releases rather than dependency drift and would report a change on
 * every version bump.
 */
function versionIndex(lockText, wantDev) {
  const named = packageEntries(lockText).filter(([path]) => path !== '');
  const matching = named.filter(([, entry]) => (entry.dev === true) === wantDev);
  return new Map(matching.map(([path, entry]) => [path, entry.version]));
}

/** Lists every path whose pinned version differs between two indexes. */
function diffVersions(before, after) {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths
    .map((path) => ({ path, from: before.get(path), to: after.get(path) }))
    .filter((change) => change.from !== change.to);
}

/**
 * Describes what a lockfile refresh changed and how it must be committed.
 *
 * A transitive runtime pin is installed into the published Docker image just
 * as literally as a direct dependency, so a change to one has to reach users
 * through a release. `.github/workflows/lockfile-refresh.yml` therefore takes
 * its commit type from here rather than hard-coding `chore`, which would let
 * a runtime change ship silently — the precise failure
 * scripts/release-signal-logic.mjs exists to prevent.
 */
export function summarizeRefresh(beforeText, afterText) {
  const runtimeChanges = diffVersions(versionIndex(beforeText, false), versionIndex(afterText, false));
  const devChanges = diffVersions(versionIndex(beforeText, true), versionIndex(afterText, true));
  const commitType = runtimeChanges.length > 0 ? 'fix' : 'chore';
  const counts = `${runtimeChanges.length} runtime and ${devChanges.length} dev`;
  const title = `${commitType}(deps): refresh ${counts} lockfile pins`;
  const hasChanges = runtimeChanges.length + devChanges.length > 0;
  return { runtimeChanges, devChanges, commitType, title, hasChanges };
}

/** Describes one pin movement in a form a reviewer can scan without the diff. */
function describeChange(change) {
  const name = packageNameFromPath(change.path);
  if (change.from === undefined) return `- \`${name}\` added at ${change.to}`;
  if (change.to === undefined) return `- \`${name}\` removed (was ${change.from})`;
  return `- \`${name}\` ${change.from} → ${change.to}`;
}

/** Renders one titled section, or nothing at all when that kind did not move. */
function changeSection(heading, changes) {
  if (changes.length === 0) return [];
  return [`## ${heading} (${changes.length})`, '', ...changes.map(describeChange), ''];
}

/** Why the chosen commit type is the correct one, stated for the reviewer. */
const RELEASE_RATIONALE = {
  fix: [
    'A runtime pin moved. Runtime dependencies are installed into the',
    'published Docker image, so this opens as `fix(deps)` and release-please',
    'cuts a release for it — a transitive bump reaches users exactly the way',
    'a direct one does.',
  ].join('\n'),
  chore: [
    'Only development pins moved. Nothing here reaches the published Docker image,',
    'so this opens as `chore(deps)` and cuts no release.',
  ].join('\n'),
};

/**
 * Renders the pull-request body for an automated refresh.
 *
 * The body has to answer the reviewer's actual question — "what moved, and why
 * is it labelled this way?" — because the diff itself is thousands of lines of
 * lockfile noise in which the handful of real changes are invisible.
 */
export function formatRefreshBody(summary) {
  return [
    'Regenerated `package-lock.json` with `npm update --package-lock-only`, which',
    're-resolves transitive dependencies inside the ranges their parents already',
    'allow. `package.json` is untouched.',
    '',
    ...changeSection('Runtime pins', summary.runtimeChanges),
    ...changeSection('Development pins', summary.devChanges),
    RELEASE_RATIONALE[summary.commitType],
  ].join('\n');
}

/**
 * Lists the remedies that apply to the defects actually found.
 *
 * The two defect classes have genuinely different fixes, and offering the
 * wrong one is worse than offering none: a maintainer told to run the local
 * repair for an integrity downgrade would be chasing a fix that cannot exist.
 */
function remediesFor(audit) {
  const remedies = [];
  if (audit.foreignRegistries.length > 0) {
    remedies.push('Mirror-rewritten URLs are repairable locally:', '  npm run refresh-lockfile', '');
  }
  if (audit.weakIntegrities.length > 0) {
    remedies.push(
      'Integrity downgrades are NOT repairable locally: a trustworthy hash requires a',
      'trustworthy tarball, which a mirrored machine cannot obtain. Re-run the',
      '"Lockfile refresh" workflow, where npm resolves and verifies tarballs itself.',
    );
  }
  return remedies;
}

/** Renders the audit verdict as operator-facing console output. */
export function formatLockfileReport(audit) {
  if (audit.ok) {
    return 'package-lock.json is canonical: every tarball resolves from the public npm registry with a strong integrity hash.';
  }
  const lines = ['package-lock.json is NOT canonical.', ''];
  for (const e of audit.foreignRegistries) lines.push(`  foreign registry  ${e.path}  ->  ${e.resolved}`);
  for (const e of audit.weakIntegrities) lines.push(`  weak integrity    ${e.path}  ->  ${e.integrity}`);
  return [...lines, '', ...remediesFor(audit)].join('\n');
}
