#!/usr/bin/env node
/**
 * Raises `overrides` floors for advisories that an exact pin keeps out of
 * reach of Dependabot and `npm update`, and prunes overrides that no longer
 * change anything. Driven by .github/workflows/lockfile-refresh.yml; the rules
 * live in scripts/override-floor-logic.mjs and are explained in ADR-0003.
 *
 * Usage (run from the repository root):
 *   node scripts/plan-override-floors.mjs --check
 *     Print the floor plan for the committed tree. Writes nothing.
 *   node scripts/plan-override-floors.mjs --apply
 *     Write the planned floors, regenerate the lockfile, re-audit, and drop any
 *     floor whose package still has an advisory (at most two passes). Prints
 *     the final plan.
 *   node scripts/plan-override-floors.mjs --prune [--check]
 *     Remove every override whose removal locks exactly the same versions.
 *     With --check, report without keeping any removal.
 *   node scripts/plan-override-floors.mjs --verify-manifest <before.json> [--plan <file>] [--prune-result <file>]
 *     Exit 1 unless package.json differs from <before.json> only in the
 *     override keys the plan floored or the prune removed.
 *
 * Every npm call goes through `assertAllowedNpmArgs`: only lockfile-only
 * `audit`, `view <pkg> time` and `update --ignore-scripts` can run, via
 * execFileSync with an argument array and never a shell. Exit 0 on success,
 * 1 on any failure; --apply and --prune restore both files before failing.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { classifyAdvisories } from '../config/audit-policy.mjs';
import { auditCommittedTree, npmInvocation } from '../config/audit-report.mjs';
import {
  applyFloors,
  assertAllowedNpmArgs,
  isFloorOverride,
  planOverrideFloors,
  sameLockedVersions,
  verifyOverrideOnlyChange,
} from './override-floor-logic.mjs';

const MANIFEST = 'package.json';
const LOCKFILE = 'package-lock.json';
const MIN_RELEASE_AGE_DAYS = 3;
const ALWAYS_AGE_EXEMPT = '@sergienko4/israeli-bank-scrapers';
const VIEW_TIMEOUT_MS = 30_000;
const MAX_PASSES = 2;

/**
 * Runs npm through the allow-list. When `npm_execpath` is set, the command is
 * the current Node binary and the first argument is the npm CLI entry point.
 *
 * @param {string} command The executable.
 * @param {string[]} args Its arguments.
 * @param {import('node:child_process').ExecFileSyncOptionsWithStringEncoding} options Spawn options.
 * @returns {string} The captured stdout.
 */
function guardedExec(command, args, options) {
  assertAllowedNpmArgs(command === process.execPath ? args.slice(1) : args);
  return execFileSync(command, args, options);
}

/**
 * Runs one allowed npm command and returns its stdout.
 *
 * @param {string[]} args The npm arguments.
 * @param {number} [timeout] Milliseconds before the call is abandoned.
 * @returns {string} The captured stdout.
 */
function runNpm(args, timeout) {
  const { command, args: argv } = npmInvocation(args);
  return guardedExec(command, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], timeout });
}

/**
 * Reads and parses a JSON file.
 *
 * @param {string} path The file path.
 * @returns {any} The parsed value.
 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Writes a manifest with the repository's formatting: two-space indent and a
 * trailing newline, which round-trips package.json byte for byte.
 *
 * @param {object} manifest The manifest to write.
 * @returns {void}
 */
function writeManifest(manifest) {
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Captures both files so a failed attempt can be undone exactly.
 *
 * @returns {{ manifest: string, lock: string }} The current file contents.
 */
function snapshot() {
  return { manifest: readFileSync(MANIFEST, 'utf8'), lock: readFileSync(LOCKFILE, 'utf8') };
}

/**
 * Writes a snapshot back.
 *
 * @param {{ manifest: string, lock: string }} files The contents to restore.
 * @returns {void}
 */
function restore(files) {
  writeFileSync(MANIFEST, files.manifest);
  writeFileSync(LOCKFILE, files.lock);
}

/**
 * Audits the committed tree and classifies it against the accepted-advisory
 * policy, exactly as `npm run audit` does.
 *
 * @returns {{ advisories: object[], violations: object[] }} Every advisory and the blocking ones.
 */
function auditTree() {
  const { advisories, productionPackages } = auditCommittedTree(guardedExec);
  return { advisories, violations: classifyAdvisories(advisories, productionPackages).violations };
}

/**
 * Fetches npm's publish times for each package. A failed or slow lookup leaves
 * the package out, which the planner rejects as missing-publish-times.
 *
 * @param {string[]} names The package names.
 * @returns {Record<string, Record<string, string>>} Publish times by package.
 */
function fetchPublishTimes(names) {
  const times = {};
  for (const name of names) {
    try {
      times[name] = JSON.parse(runNpm(['view', name, 'time', '--json'], VIEW_TIMEOUT_MS));
    } catch (error) {
      console.error(`::warning::npm view ${name} time failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return times;
}

/**
 * Plans floors for the tree on disk.
 *
 * @param {{ advisories: object[], violations: object[] }} [audit] The tree's audit, when already run.
 * @returns {import('./override-floor-logic.d.mts').IFloorPlan} The plan.
 */
function planCurrentTree(audit = auditTree()) {
  const { advisories, violations } = audit;
  const names = [...new Set(violations.map(violation => violation.package))];
  return planOverrideFloors({
    violations,
    advisories,
    manifest: readJson(MANIFEST),
    lockPackages: readJson(LOCKFILE).packages ?? {},
    publishTimes: names.length > 0 ? fetchPublishTimes(names) : {},
    now: new Date().toISOString(),
    minReleaseAgeDays: MIN_RELEASE_AGE_DAYS,
  });
}

/**
 * Builds the lockfile regeneration command for a set of floors: the refresh's
 * release-age window, lifted only for floors younger than it.
 *
 * @param {ReadonlyArray<{ package: string, excludeFromAge: boolean }>} floors The floors.
 * @returns {string[]} The npm arguments.
 */
function updateArgs(floors) {
  const exempt = floors.filter(floor => floor.excludeFromAge).map(floor => `--min-release-age-exclude=${floor.package}`);
  return [
    'update',
    ...floors.map(floor => floor.package),
    '--package-lock-only',
    '--ignore-scripts',
    `--min-release-age=${MIN_RELEASE_AGE_DAYS}`,
    `--min-release-age-exclude=${ALWAYS_AGE_EXEMPT}`,
    ...exempt,
  ];
}

/**
 * Identifies one blocking advisory on one package.
 *
 * @param {{ package: string, ghsa: string }} violation The violation.
 * @returns {string} Its key.
 */
function violationKey(violation) {
  return `${violation.package}::${violation.ghsa}`;
}

/**
 * Judges a regenerated tree. A floor counts only when its package is left with
 * no advisory at all, accepted or not — the same bar R3 planned it against:
 * `npm update` may resolve above the floor, into a version that is still in a
 * range or carries an advisory the planner never saw. A blocking advisory new
 * on any other package came in with a floored release; npm cannot say which,
 * so every floor in the pass is unproven.
 *
 * @param {{ advisories: object[], violations: object[] }} audit The regenerated tree's audit.
 * @param {ReadonlyArray<object>} floors The floors tried.
 * @param {ReadonlySet<string>} known Violation keys of the tree before any floor.
 * @returns {string[]} Packages whose floor is unproven.
 */
function unprovenFloors(audit, floors, known) {
  const floored = new Set(floors.map(floor => floor.package));
  const introduced = audit.violations.some(violation => !floored.has(violation.package) && !known.has(violationKey(violation)));
  if (introduced) return [...floored];
  const flagged = new Set(audit.advisories.map(advisory => advisory.package));
  return floors.filter(floor => flagged.has(floor.package)).map(floor => floor.package);
}

/**
 * Writes floors onto the snapshot, regenerates the lockfile and re-audits.
 *
 * @param {{ manifest: string, lock: string }} base The pre-floor files.
 * @param {ReadonlyArray<object>} floors The floors to try.
 * @param {ReadonlySet<string>} known Violation keys of the tree before any floor.
 * @returns {{ audit: { advisories: object[], violations: object[] }, unproven: string[] }} The regenerated tree's audit and the packages whose floor is unproven.
 */
function tryFloors(base, floors, known) {
  restore(base);
  writeManifest(applyFloors(JSON.parse(base.manifest), floors));
  runNpm(updateArgs(floors));
  const audit = auditTree();
  return { audit, unproven: unprovenFloors(audit, floors, known) };
}

/**
 * Keeps the rejections whose package still has a blocking advisory in the
 * floored tree. A surviving floor's release may have relocked or dropped a
 * package the plan rejected; holding the refresh for it would be stale.
 *
 * @param {object[]} rejections The rejections so far.
 * @param {{ violations: object[] }} audit The floored tree's audit.
 * @returns {object[]} The rejections that still stand.
 */
function stillBlocking(rejections, audit) {
  const blocking = new Set(audit.violations.map(violation => violation.package));
  return rejections.filter(rejection => blocking.has(rejection.package));
}

/**
 * Sorts a plan's lists and recomputes whether it needs a human.
 *
 * @param {object[]} floors The surviving floors.
 * @param {object[]} rejections Every rejection.
 * @returns {import('./override-floor-logic.d.mts').IFloorPlan} The final plan.
 */
function finalPlan(floors, rejections) {
  const byPackage = (a, b) => (a.package < b.package ? -1 : 1);
  const requiresReview = rejections.length > 0 || floors.some(floor => floor.kind !== 'in-line');
  return { floors: [...floors].sort(byPackage), rejections: [...rejections].sort(byPackage), requiresReview };
}

/**
 * Applies the plan, proving each floor left its package with no advisory and
 * brought no new blocking advisory onto any other package. An unproven floor
 * becomes `floor-ineffective` and the rest are retried; after the last pass
 * every unproven floor is rejected and both files are left untouched. When
 * floors survive, only rejections still blocking in the floored tree remain.
 *
 * @param {{ manifest: string, lock: string }} base The pre-floor files.
 * @returns {import('./override-floor-logic.d.mts').IFloorPlan} The final plan.
 */
function applyPlan(base) {
  const audit = auditTree();
  const known = new Set(audit.violations.map(violationKey));
  const plan = planCurrentTree(audit);
  let floors = plan.floors;
  let rejections = [...plan.rejections];
  for (let pass = 1; floors.length > 0; pass++) {
    const trial = tryFloors(base, floors, known);
    if (trial.unproven.length === 0) {
      rejections = stillBlocking(rejections, trial.audit);
      break;
    }
    restore(base);
    const stuck = floors.filter(floor => pass >= MAX_PASSES || trial.unproven.includes(floor.package));
    rejections.push(...stuck.map(floor => ({ package: floor.package, ghsas: floor.ghsas, reason: 'floor-ineffective' })));
    floors = floors.filter(floor => !stuck.includes(floor));
  }
  return finalPlan(floors, rejections);
}

/**
 * Reports whether regenerating the lockfile without an override locks exactly
 * the same versions. A failed regeneration counts as a change, so the
 * override is kept.
 *
 * @param {string} name The override key, already removed from package.json.
 * @param {string} lockText The lockfile before the removal.
 * @returns {boolean} True when the override shaped nothing.
 */
function lockUnchangedWithout(name, lockText) {
  try {
    runNpm(['update', name, '--package-lock-only', '--ignore-scripts']);
    return sameLockedVersions(JSON.parse(lockText), readJson(LOCKFILE));
  } catch (error) {
    console.error(`::warning::npm update ${name} failed while pruning: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Tries removing one override. The removal stands only when the regenerated
 * lockfile locks exactly the same versions; the lockfile text is then put
 * back, because the override was not shaping it.
 *
 * @param {string} name The override key.
 * @returns {string | null} Why the override was kept, or null when it was pruned.
 */
function tryPrune(name) {
  const before = snapshot();
  const manifest = JSON.parse(before.manifest);
  if (!isFloorOverride(manifest.overrides[name])) return 'not-a-floor';
  delete manifest.overrides[name];
  writeManifest(manifest);
  const unchanged = lockUnchangedWithout(name, before.lock);
  writeFileSync(LOCKFILE, before.lock);
  if (unchanged) return null;
  writeFileSync(MANIFEST, before.manifest);
  return 'changes-locked-versions';
}

/**
 * Tries removing every override in name order.
 *
 * @param {{ manifest: string, lock: string }} base The files before pruning.
 * @param {boolean} checkOnly Restore the files afterwards.
 * @returns {{ pruned: string[], kept: Array<{ package: string, reason: string }> }} The outcome.
 */
function prune(base, checkOnly) {
  const result = { pruned: [], kept: [] };
  for (const name of Object.keys(JSON.parse(base.manifest).overrides ?? {}).sort()) {
    const reason = tryPrune(name);
    if (reason === null) result.pruned.push(name);
    else result.kept.push({ package: name, reason });
  }
  if (checkOnly) restore(base);
  return result;
}

/**
 * Checks package.json changed only where the plan and prune said it would.
 *
 * @param {{ 'verify-manifest': string, plan?: string, 'prune-result'?: string }} values The parsed flags.
 * @returns {import('./override-floor-logic.d.mts').IManifestVerdict} The verdict.
 */
function verifyManifest(values) {
  const floored = values.plan ? readJson(values.plan).floors.map(floor => floor.package) : [];
  const pruned = values['prune-result'] ? readJson(values['prune-result']).pruned : [];
  return verifyOverrideOnlyChange(readJson(values['verify-manifest']), readJson(MANIFEST), [...floored, ...pruned]);
}

/**
 * Runs a mutating mode, restoring both files if it fails part-way.
 *
 * @param {(base: { manifest: string, lock: string }) => object} mode The mode.
 * @returns {object} The mode's result.
 */
function withRollback(mode) {
  const base = snapshot();
  try {
    return mode(base);
  } catch (error) {
    restore(base);
    throw error;
  }
}

/** One handler per mode; the first flag present wins. */
const MODES = [
  ['verify-manifest', values => verifyManifest(values)],
  ['prune', values => withRollback(base => prune(base, values.check === true))],
  ['apply', () => withRollback(applyPlan)],
  ['check', () => planCurrentTree()],
];

/**
 * Parses the flags and runs the selected mode.
 *
 * @returns {object} The mode's JSON result.
 */
function main() {
  const { values } = parseArgs({
    options: {
      check: { type: 'boolean' },
      apply: { type: 'boolean' },
      prune: { type: 'boolean' },
      'verify-manifest': { type: 'string' },
      plan: { type: 'string' },
      'prune-result': { type: 'string' },
    },
    strict: true,
  });
  const mode = MODES.find(([flag]) => values[flag] !== undefined);
  if (mode === undefined) throw new Error('choose one of --check, --apply, --prune or --verify-manifest');
  return mode[1](values);
}

try {
  const result = main();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.ok === false) {
    console.error(`::error::package.json changed beyond the planned overrides: ${result.reason}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`plan-override-floors failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
