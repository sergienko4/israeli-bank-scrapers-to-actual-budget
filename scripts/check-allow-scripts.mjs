/**
 * scripts/check-allow-scripts.mjs
 *
 * Guards the `allowScripts` allowlist in package.json against version drift.
 *
 * Since npm v12 dependency install scripts do not run unless the exact
 * `<name>@<version>` is allowlisted. Bumping such a dependency therefore
 * leaves its pin stale and npm silently blocks the script. For
 * `better-sqlite3` that means the native binding is never built, so
 * `@actual-app/api` cannot open a budget and every E2E import fails ~14
 * minutes into the pipeline with an opaque "Could not locate the bindings
 * file". This gate turns that into an instant, actionable failure.
 *
 * The required set is derived from package-lock.json rather than hard-coded:
 * every `<name>@<version>` that declares an install script
 * (`hasInstallScript`) and is not `optional` needs its own pin. The policy
 * lives in scripts/allow-scripts-logic.mjs; this file only reads, reports and
 * writes.
 *
 * Modes:
 *   default:  report drift on stderr, exit 1 if any pin is wrong
 *   --fix:    rotate the pins of already-approved packages in place and drop
 *             entries the tree no longer needs, preserving key order, exit 0,
 *             listing every change on stdout so the Dependabot workflow can
 *             quote it into the comment that asks a human to review the newly
 *             approved install scripts
 *   --drop-orphans:
 *             delete only the entries the tree no longer needs, listing each
 *             on stdout, exit 0 even if stale or missing pins remain; the
 *             lockfile refresh uses it because withdrawing an approval can
 *             never let a script run, so no review is owed. A package that
 *             still has an unapproved version in the tree keeps its entries
 *
 * At most one repair flag may be given. `--fix` never approves a package that
 * is not on the allowlist already. A dependency that has newly gained an
 * install script is a new decision, not a rotation of an existing one, so it
 * is left to fail the gate for a human. `--drop-orphans` goes further and
 * never rotates either.
 *
 * Contract:
 *   - Idempotent: running twice produces identical bytes
 *   - Never widens a pin to a bare name; every entry stays `<name>@<version>`
 *   - Reports the exact `npm approve-scripts <name>` command to run
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  approvedPins,
  diffPins,
  dropOrphanPins,
  rebuildAllowScripts,
  requiredPins,
  withdrawableOrphans,
} from './allow-scripts-logic.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_JSON_PATH = resolve(REPO_ROOT, 'package.json');
const LOCKFILE_PATH = resolve(REPO_ROOT, 'package-lock.json');

/**
 * Reads and parses a JSON file from disk.
 *
 * @param {string} path absolute path to the JSON file
 * @returns {object} the parsed document
 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Prints a human-readable report of every finding.
 *
 * The `stale pin: ` line prefix is a contract, not just prose:
 * `.github/workflows/dependabot-meta-render.yml` greps for it to tell a
 * re-approval (which needs a human to read a release diff) apart from an
 * orphan removal (which withdraws an approval and needs nobody). Renaming it
 * silently stops that review request from being posted.
 *
 * @param {{ stale: object[], missing: object[], orphan: object[] }} findings
 * @param {(line: string) => void} log sink for each reported line
 * @returns {void}
 */
function report({ stale, missing, orphan }, log) {
  for (const { name, version, was } of stale) {
    log(`stale pin: ${name}@${was} -> ${name}@${version}`);
  }
  for (const { name, version } of missing) {
    log(`missing pin: ${name}@${version} declares an install script`);
  }
  for (const { name, was } of orphan) {
    log(`orphan pin: ${name}@${was} no longer needs an install script`);
  }
}

/**
 * Writes the manifest back to package.json in the repository's own format.
 *
 * @param {object} pkg parsed package.json
 * @returns {void}
 */
function writePackage(pkg) {
  writeFileSync(PACKAGE_JSON_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
}

/**
 * Writes the corrected allowlist back to package.json.
 *
 * @param {object} pkg parsed package.json
 * @param {Set<string>} required pins the tree requires
 * @param {object[]} stale the pins to rotate in place
 * @returns {void}
 */
function applyFix(pkg, required, stale) {
  pkg.allowScripts = rebuildAllowScripts(pkg.allowScripts, required, stale);
  writePackage(pkg);
}

/**
 * Repairs the allowlist and reports every rotation on stdout.
 *
 * The report is the payload the Dependabot workflow quotes back into its
 * review-request comment, so it goes to stdout rather than stderr. Missing
 * pins are reported but never written: see {@link rebuildAllowScripts}.
 *
 * @param {object} pkg parsed package.json
 * @param {Set<string>} required pins the tree requires
 * @param {{ stale: object[], missing: object[], orphan: object[] }} findings
 * @returns {void}
 */
function runFix(pkg, required, findings) {
  const { stale, missing, orphan } = findings;
  if (stale.length + orphan.length > 0) {
    report({ stale, missing: [], orphan }, console.log);
    applyFix(pkg, required, stale);
  }
  for (const { name, version } of missing) {
    console.log(
      `needs human approval: ${name}@${version} is not approved — ` +
        `run npm approve-scripts ${name}`
    );
  }
  if (countFindings(findings) === 0) console.log('allowScripts pins already correct.');
}

/**
 * Withdraws approvals the tree no longer needs and nothing else.
 *
 * Removing an approval can never let an install script run, so this is the
 * one repair an unattended workflow may apply. A package still moving between
 * scripted releases keeps its approvals, and stale and missing pins stay as
 * they are for a human to decide. None of them fail this mode: the gate
 * itself still reports them.
 *
 * @param {object} pkg parsed package.json
 * @param {{ stale: object[], missing: object[], orphan: object[] }} findings
 * @returns {void}
 */
function runDropOrphans(pkg, findings) {
  const orphan = withdrawableOrphans(findings);
  if (orphan.length === 0) {
    console.log('No orphan allowScripts pins to drop.');
    return;
  }
  report({ stale: [], missing: [], orphan }, console.log);
  pkg.allowScripts = dropOrphanPins(pkg.allowScripts, orphan);
  writePackage(pkg);
}

/**
 * Prints the command or instruction that resolves each class of finding.
 *
 * @param {{ stale: object[], missing: object[], orphan: object[] }} findings
 * @returns {void}
 */
function reportRemedy({ stale, missing, orphan }) {
  const names = [...new Set([...stale, ...missing].map(f => f.name))];
  if (names.length > 0) {
    console.error(`\nRun: ${names.map(n => `npm approve-scripts ${n}`).join(' && ')}`);
  }
  if (orphan.length > 0) {
    const entries = orphan.map(o => `${o.name}@${o.was}`).join(', ');
    console.error(`\nDelete from \`allowScripts\` in package.json: ${entries}`);
  }
}

/**
 * Reports drift and fails the process when the allowlist is out of date.
 *
 * @param {{ stale: object[], missing: object[], orphan: object[] }} findings
 * @returns {void}
 */
function runCheck(findings) {
  if (countFindings(findings) === 0) {
    console.log('✅ allowScripts pins match the installed tree');
    return;
  }
  report(findings, console.error);
  reportRemedy(findings);
  console.error('\nSee docs/CONTRIBUTING.md "Dependency install scripts (allowScripts)".');
  process.exit(1);
}

/**
 * Counts every classified difference.
 *
 * @param {{ stale: object[], missing: object[], orphan: object[] }} findings
 * @returns {number} the total number of pins needing correction
 */
function countFindings({ stale, missing, orphan }) {
  return stale.length + missing.length + orphan.length;
}

/** One repair handler per flag; no flag means check. */
const MODES = [
  ['--fix', (pkg, required, findings) => runFix(pkg, required, findings)],
  ['--drop-orphans', (pkg, _required, findings) => runDropOrphans(pkg, findings)],
];

/**
 * Picks the repair the command line asks for, refusing an ambiguous request.
 *
 * Two repair flags would otherwise run whichever sits first in {@link MODES},
 * which is the one that rotates pins.
 *
 * @returns {[string, Function] | undefined} the requested mode, or undefined for the plain check
 */
function selectMode() {
  const requested = MODES.filter(([flag]) => process.argv.includes(flag));
  if (requested.length > 1) {
    console.error(`Pass at most one of: ${MODES.map(([flag]) => flag).join(', ')}`);
    process.exit(2);
  }
  return requested[0];
}

/**
 * Entry point: compares the allowlist and either reports or repairs drift.
 *
 * An allowlist entry the gate cannot read fails every mode, so a repair never
 * rewrites an allowlist it misread.
 *
 * @returns {void}
 */
function main() {
  const mode = selectMode();
  const pkg = readJson(PACKAGE_JSON_PATH);
  const required = requiredPins(readJson(LOCKFILE_PATH));
  let approved;
  try {
    approved = approvedPins(pkg.allowScripts);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const findings = diffPins(required, approved);

  if (mode === undefined) runCheck(findings);
  else mode[1](pkg, required, findings);
}

main();
