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

/**
 * Reports whether an entry's integrity is weaker than npm's current default.
 *
 * A registry tarball recorded with no integrity at all is the weakest case:
 * npm would install it unverified. Entries that resolve elsewhere (`file:`,
 * `link:`, `git+`) or not at all (bundled packages) legitimately carry none.
 */
function isWeakIntegrity(entry) {
  if (typeof entry.integrity === 'string') return !STRONG_INTEGRITY_PATTERN.test(entry.integrity);
  return typeof entry.resolved === 'string' && HTTP_URL_PATTERN.test(entry.resolved);
}

/** Lists every package whose tarball resolves from outside public npm. */
export function findForeignRegistryEntries(lockText) {
  return packageEntries(lockText)
    .filter(([, entry]) => isForeignRegistryUrl(entry.resolved))
    .map(([path, entry]) => ({ path, resolved: entry.resolved }));
}

/**
 * Lists every package recorded with a downgraded integrity hash, or a
 * registry tarball with none. A missing hash is reported as `''`.
 */
export function findWeakIntegrities(lockText) {
  return packageEntries(lockText)
    .filter(([, entry]) => isWeakIntegrity(entry))
    .map(([path, entry]) => ({ path, integrity: typeof entry.integrity === 'string' ? entry.integrity : '' }));
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

/**
 * Why a repaired lockfile still carries hashes this tool has not checked.
 *
 * Rewriting `resolved` does not re-derive `integrity`, and deliberately so.
 * Verifying a hash means hashing the public tarball, which is precisely what a
 * mirrored machine cannot fetch — the condition that makes the repair
 * necessary in the first place. Fetching a replacement hash from the registry
 * would not be a stronger check but a weaker one: it would overwrite the only
 * evidence that the mirror served different bytes, turning a loud `npm ci`
 * failure into a silent divergence between what was installed here and what
 * ships. Leaving the mirror's hash in place keeps that failure loud.
 */
const INTEGRITY_CAVEAT = [
  'Their integrity hashes came from the mirror and are NOT verified here:',
  'checking one means hashing the public tarball, which is the very thing a',
  'mirrored machine cannot fetch. Replacing them with registry-supplied hashes',
  'would erase the evidence that the mirror served different bytes, so they are',
  'left as-is on purpose. `npm ci` in CI verifies them against the real tarball.',
  'An EINTEGRITY failure there means the bytes differed — re-run the "Lockfile',
  'refresh" workflow rather than repairing again locally.',
];

/**
 * Reports what the repair changed, without overstating what it proved.
 *
 * The count alone reads like a clean bill of health, which would leave a
 * maintainer baffled when CI later rejects the very file this tool just called
 * repaired. Naming the unverified part here is what makes that outcome
 * predictable instead of surprising.
 */
export function formatRepairSummary(replaced) {
  const headline = `Rewrote ${replaced} mirror-sourced registry URL(s).`;
  return replaced === 0 ? headline : [headline, '', ...INTEGRITY_CAVEAT].join('\n');
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

const SEMVER_CORE = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

/**
 * Returns the semver component whose change signals a breaking release:
 * major for `>=1`, minor for `0.x`, patch for `0.0.x`. Returns `undefined`
 * for a version this module cannot parse.
 */
function breakingKey(version) {
  const match = SEMVER_CORE.exec(version ?? '');
  if (match === null) return undefined;
  const [, major, minor, patch] = match;
  if (major !== '0') return `${major}`;
  if (minor !== '0') return `0.${minor}`;
  return `0.0.${patch}`;
}

/** Whether moving between two pinned versions crosses a breaking boundary. */
function crossesBreakingBoundary(change) {
  const fromKey = breakingKey(change.from);
  const toKey = breakingKey(change.to);
  if (fromKey === undefined || toKey === undefined) return true;
  return fromKey !== toKey;
}

/**
 * Indexes a lockfile by path: every entry, root included, and the version of
 * every non-root entry. The root records the project itself, so it has no
 * version worth comparing but its declared dependencies still matter.
 */
function lockIndex(lockText) {
  const entries = new Map(packageEntries(lockText));
  const named = [...entries].filter(([path]) => path !== '');
  return { entries, versions: new Map(named.map(([path, entry]) => [path, entry.version])) };
}

/** Every field through which a lockfile entry declares a package it loads. */
const DEPENDENCY_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
];

/** Lists the package names a lockfile entry declares in any dependency field. */
function declaredNames(entry) {
  return DEPENDENCY_FIELDS.filter((field) => isRecord(entry[field])).flatMap((field) =>
    Object.keys(entry[field]),
  );
}

/**
 * Lists the directories node searches from a consumer, nearest first.
 *
 * Every ancestor folder is a candidate, not only the ones npm installed a
 * package into: a nested workspace such as `packages/a/sub` also reaches
 * `packages/a/node_modules`. Folders already named `node_modules` are
 * skipped, exactly as node does, because `node_modules/node_modules` is
 * never searched.
 * See https://nodejs.org/api/modules.html#loading-from-node_modules-folders
 */
function lookupChain(consumerPath) {
  const parts = consumerPath === '' ? [] : consumerPath.split('/');
  const chain = [];
  for (let end = parts.length; end > 0; end -= 1) {
    if (parts[end - 1] !== 'node_modules') chain.push(parts.slice(0, end).join('/'));
  }
  return [...chain, ''];
}

/** Finds the lockfile path node would load for `name` when `consumerPath` requires it. */
function resolvePath(entries, consumerPath, name) {
  return lookupChain(consumerPath)
    .map((base) => (base === '' ? `node_modules/${name}` : `${base}/node_modules/${name}`))
    .find((candidate) => entries.has(candidate));
}

/**
 * Follows npm `link` entries to the folder they stand for.
 *
 * A link records no version of its own; `resolved` names the entry that
 * holds the real package. Returns `undefined` for a cycle or a link with no
 * `resolved`, so the caller keeps the link itself, whose missing version is
 * never read as safe.
 * See https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json#packages
 */
function followLink(entries, path) {
  const seen = new Set();
  let current = path;
  while (entries.get(current)?.link === true && !seen.has(current)) {
    seen.add(current);
    const target = entries.get(current).resolved;
    if (typeof target !== 'string') return undefined;
    current = target;
  }
  return seen.has(current) ? undefined : current;
}

/**
 * Finds the copy of `name` that a consumer at `consumerPath` loads, or
 * `undefined` when nothing on its lookup chain provides it. A link is
 * reported as the folder it points at, which carries the real version.
 */
function resolvedCopy(index, consumerPath, name) {
  const found = resolvePath(index.entries, consumerPath, name);
  if (found === undefined) return undefined;
  const path = followLink(index.entries, found) ?? found;
  return { path, version: index.entries.get(path)?.version };
}

/**
 * Lists the earlier copies of a package on the same breaking line as
 * `version`. A version that does not parse has no line and matches none,
 * so the caller falls back to every copy rather than guessing.
 */
function sameLineCopies(copies, version) {
  const line = breakingKey(version);
  if (line === undefined) return [];
  return [...copies]
    .filter(([prior]) => breakingKey(prior) === line)
    .flatMap(([, paths]) => paths);
}

/**
 * Lists the paths a consumer occupied before the refresh.
 *
 * A path present on both sides is the consumer itself. Otherwise npm moved
 * the consumer — hoisted it or nested it anew — so its earlier copies are
 * matched by package name: the same version first, then the same major
 * line, any version after that. A different major line is a different
 * release whose dependencies say nothing about this one, so it is consulted
 * only when nothing closer exists. A package absent before the refresh has
 * no earlier copy and yields none.
 */
function priorConsumers(before, consumer, afterEntry) {
  if (before.entries.has(consumer)) return [consumer];
  const copies = before.byName.get(packageNameFromPath(consumer));
  if (copies === undefined) return [];
  const same = copies.get(afterEntry.version);
  if (same !== undefined) return same;
  const line = sameLineCopies(copies, afterEntry.version);
  return line.length > 0 ? line : [...copies.values()].flat();
}

/**
 * Lists the versions of `name` that earlier copies of a consumer loaded.
 *
 * Only copies that declared `name` count: a dependency the refresh added has
 * nothing to break from, so it is never compared against an unrelated copy
 * that happened to sit on the old lookup chain.
 */
function priorVersions(before, priors, name) {
  return priors
    .filter((prior) => declaredNames(before.entries.get(prior)).includes(name))
    .map((prior) => resolvedCopy(before, prior, name))
    .filter((copy) => copy !== undefined)
    .map((copy) => copy.version);
}

/**
 * Describes a consumer's copy of `name` when it crossed a breaking boundary
 * against any version an earlier copy of that consumer loaded.
 *
 * A moved consumer can have several earlier copies that loaded different
 * majors, and nothing in the lockfile says which one npm kept. The check
 * fails closed: one earlier copy the new copy breaks from is enough, and the
 * change reports that copy's version.
 */
function consumerChange(before, after, request) {
  const target = resolvedCopy(after, request.consumer, request.name);
  if (target === undefined) return undefined;
  const to = target.version;
  const from = priorVersions(before, request.priors, request.name).find(
    (prior) => prior !== to && crossesBreakingBoundary({ from: prior, to }),
  );
  return from === undefined ? undefined : { path: target.path, from, to };
}

/** Lists majors that a consumer present before the refresh now loads. */
function consumerMajors(before, after) {
  const prior = { ...before, byName: versionsByName(before.versions) };
  const changes = [];
  for (const [consumer, afterEntry] of after.entries) {
    const priors = priorConsumers(prior, consumer, afterEntry);
    for (const name of new Set(declaredNames(afterEntry))) {
      const change = consumerChange(prior, after, { consumer, priors, name });
      if (change !== undefined) changes.push(change);
    }
  }
  return changes;
}

/** Keeps the first change recorded for each path. */
function uniqueByPath(changes) {
  const byPath = new Map();
  for (const change of changes) if (!byPath.has(change.path)) byPath.set(change.path, change);
  return [...byPath.values()];
}

/** Groups the paths in a path→version index by package name and version. */
function versionsByName(paths) {
  const byName = new Map();
  for (const [path, version] of paths) {
    const name = packageNameFromPath(path);
    const versions = byName.get(name) ?? new Map();
    versions.set(version, [...(versions.get(version) ?? []), path]);
    byName.set(name, versions);
  }
  return byName;
}

/** Lists majors that appear at a path the package did not occupy before. */
function relocatedMajors(before, after) {
  const beforeByName = versionsByName(before);
  const changes = [];
  for (const [name, afterVersions] of versionsByName(after)) {
    const known = beforeByName.get(name);
    if (known === undefined) continue;
    const priors = [...known.keys()];
    for (const [to, paths] of afterVersions) {
      if (known.has(to)) continue;
      if (!priors.every((from) => crossesBreakingBoundary({ from, to }))) continue;
      changes.push(...paths.map((path) => ({ path, from: priors[0], to })));
    }
  }
  return changes;
}

/**
 * Lists every package whose installed version crossed a semver-breaking
 * boundary, across runtime and development entries alike.
 *
 * `npm update` stays inside the ranges parents declare, but some declared
 * ranges are open-ended — `sax: ">=0.6.0"` or `@types/deep-eql: "*"` — so a
 * "within range" refresh can still land a new major. The refresh workflow
 * withholds auto-merge whenever this list is non-empty. A version that does
 * not parse counts as breaking: an unknown jump is never treated as safe.
 *
 * Three shapes are caught. A path present on both sides that re-pins across
 * a boundary is the plain case. A version that npm installs at a new path — a
 * hoisted copy kept while a nested one lands next to it, or a hoisted copy
 * moved under its parent — is caught by name: a version the package never
 * had before is listed when it is breaking relative to every version the
 * package had. The last shape is per consumer: a dependant whose resolved
 * copy of a package crosses a boundary is listed even when that version
 * already sat elsewhere in the tree, because the dependant itself now loads
 * a new major. A dependant npm moved is compared through its earlier copies,
 * matched by name — preferring the same version, then the same major line —
 * and only for a package it declared on both sides; when those copies loaded
 * different majors, breaking from any one of them is enough, because the
 * lockfile cannot say which copy npm kept. The
 * dependant's copy is found the way node finds it — through every ancestor
 * folder, so a nested workspace reaches its parent's copies — and an npm
 * `link` is followed to the folder it points at, so a workspace or `file:`
 * dependency is judged by the version it actually installs. A brand-new
 * package has nothing to break from and is not listed; neither is a
 * removal. Each path is listed once.
 */
export function findMajorBumps(beforeText, afterText) {
  const before = lockIndex(beforeText);
  const after = lockIndex(afterText);
  const repinned = diffVersions(before.versions, after.versions)
    .filter((change) => before.versions.has(change.path) && after.versions.has(change.path))
    .filter(crossesBreakingBoundary);
  const relocated = relocatedMajors(before.versions, after.versions);
  const consumer = consumerMajors(before, after);
  return uniqueByPath([...repinned, ...relocated, ...consumer]).sort((a, b) =>
    a.path.localeCompare(b.path),
  );
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
 * Warns the reviewer that the refresh crossed a breaking boundary and why the
 * workflow left it unarmed. Renders nothing when no major moved.
 */
function majorSection(majorBumps) {
  if (majorBumps === undefined || majorBumps.length === 0) return [];
  return [
    `## Major-version jumps (${majorBumps.length})`,
    '',
    ...majorBumps.map(describeChange),
    '',
    'An open-ended range let these cross a semver-breaking boundary. Auto-merge',
    'is withheld and the PR is labelled `needs-manual-review`: a maintainer',
    'must confirm each jump before it merges.',
    '',
  ];
}

/**
 * Renders the pull-request body for an automated refresh.
 *
 * The body has to answer the reviewer's actual question — "what moved, and why
 * is it labelled this way?" — because the diff itself is thousands of lines of
 * lockfile noise in which the handful of real changes are invisible.
 */
export function formatRefreshBody(summary) {
  return [
    'Regenerated `package-lock.json` with `npm update --package-lock-only`, then',
    '`npm audit fix --package-lock-only` (never `--force`). Both re-resolve',
    'transitive dependencies inside the ranges their parents already allow.',
    '`package.json` is untouched.',
    '',
    ...majorSection(summary.majorBumps),
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
      'Missing or downgraded integrity is NOT repairable locally: a trustworthy hash requires a',
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
  for (const e of audit.weakIntegrities) lines.push(`  weak integrity    ${e.path}  ->  ${e.integrity || '(missing)'}`);
  return [...lines, '', ...remediesFor(audit)].join('\n');
}
