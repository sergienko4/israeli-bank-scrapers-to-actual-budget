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
 *
 * `--fix` never approves a package that is not on the allowlist already. A
 * dependency that has newly gained an install script is a new decision, not a
 * rotation of an existing one, so it is left to fail the gate for a human.
 *
 * Contract:
 *   - Idempotent: running twice produces identical bytes
 *   - Never widens a pin to a bare name; every entry stays `<name>@<version>`
 *   - Reports the exact `npm approve-scripts <name>` command to run
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { approvedPins, diffPins, rebuildAllowScripts, requiredPins } from './allow-scripts-logic.mjs';

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
 * Writes the corrected allowlist back to package.json.
 *
 * @param {object} pkg parsed package.json
 * @param {Set<string>} required pins the tree requires
 * @param {object[]} stale the pins to rotate in place
 * @returns {void}
 */
function applyFix(pkg, required, stale) {
  pkg.allowScripts = rebuildAllowScripts(pkg.allowScripts, required, stale);
  writeFileSync(PACKAGE_JSON_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
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

/**
 * Entry point: compares the allowlist and either reports or repairs drift.
 *
 * An allowlist entry the gate cannot read fails both modes, so `--fix` never
 * rewrites an allowlist it misread.
 *
 * @returns {void}
 */
function main() {
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

  if (process.argv.includes('--fix')) runFix(pkg, required, findings);
  else runCheck(findings);
}

main();
