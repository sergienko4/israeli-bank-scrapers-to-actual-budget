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
 * a package needs a pin exactly when it declares an install script
 * (`hasInstallScript`) and is not `optional`. Optional packages are excluded
 * because npm tolerates their absence — `fsevents` is darwin-only and is
 * never installed on the CI or container platforms.
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

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_JSON_PATH = resolve(REPO_ROOT, 'package.json');
const LOCKFILE_PATH = resolve(REPO_ROOT, 'package-lock.json');
const NODE_MODULES = 'node_modules/';

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
 * Derives the pins the installed tree actually requires.
 *
 * @param {object} lockfile parsed package-lock.json
 * @returns {Map<string, string>} package name to required version
 */
function requiredPins(lockfile) {
  const required = new Map();
  for (const [key, entry] of Object.entries(lockfile.packages ?? {})) {
    if (!key.includes(NODE_MODULES) || !entry.hasInstallScript) continue;
    if (entry.optional) continue;
    required.set(nameFromLockKey(key), entry.version);
  }
  return required;
}

/**
 * Reads the current allowlist as a name-to-version map.
 *
 * @param {object} pkg parsed package.json
 * @returns {Map<string, string>} package name to allowlisted version
 */
function currentPins(pkg) {
  const current = new Map();
  for (const entry of Object.keys(pkg.allowScripts ?? {})) {
    const { name, version } = splitPin(entry);
    current.set(name, version);
  }
  return current;
}

/**
 * Compares the allowlist against the tree and classifies every difference.
 *
 * @param {Map<string, string>} required pins the tree requires
 * @param {Map<string, string>} current pins the allowlist declares
 * @returns {{ stale: object[], missing: object[], orphan: object[] }} findings
 */
function diffPins(required, current) {
  const stale = [];
  const missing = [];
  for (const [name, version] of required) {
    if (!current.has(name)) missing.push({ name, version });
    else if (current.get(name) !== version) {
      stale.push({ name, version, was: current.get(name) });
    }
  }
  const orphan = [...current.keys()]
    .filter(name => !required.has(name))
    .map(name => ({ name, was: current.get(name) }));
  return { stale, missing, orphan };
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
 * Rebuilds the allowlist, keeping existing key order to minimise the diff.
 *
 * Rotates the version of packages that are already approved and drops entries
 * the tree no longer needs. A package absent from the allowlist is deliberately
 * *not* added: approving a dependency that has newly gained an install script
 * is a decision a human has to make, so it is left to fail the gate.
 *
 * @param {object} pkg parsed package.json
 * @param {Map<string, string>} required pins the tree requires
 * @returns {Record<string, boolean>} the corrected allowlist
 */
function rebuildAllowScripts(pkg, required) {
  const rebuilt = {};
  for (const entry of Object.keys(pkg.allowScripts ?? {})) {
    const { name } = splitPin(entry);
    if (required.has(name)) rebuilt[`${name}@${required.get(name)}`] = true;
  }
  return rebuilt;
}

/**
 * Writes the corrected allowlist back to package.json.
 *
 * @param {object} pkg parsed package.json
 * @param {Map<string, string>} required pins the tree requires
 * @returns {void}
 */
function applyFix(pkg, required) {
  pkg.allowScripts = rebuildAllowScripts(pkg, required);
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
 * @param {Map<string, string>} required pins the tree requires
 * @param {{ stale: object[], missing: object[], orphan: object[] }} findings
 * @returns {void}
 */
function runFix(pkg, required, findings) {
  const { stale, missing, orphan } = findings;
  if (stale.length + orphan.length > 0) {
    report({ stale, missing: [], orphan }, console.log);
    applyFix(pkg, required);
  }
  for (const { name, version } of missing) {
    console.log(
      `needs human approval: ${name}@${version} is not approved at all — ` +
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
 * @returns {void}
 */
function main() {
  const pkg = readJson(PACKAGE_JSON_PATH);
  const required = requiredPins(readJson(LOCKFILE_PATH));
  const findings = diffPins(required, currentPins(pkg));

  if (process.argv.includes('--fix')) runFix(pkg, required, findings);
  else runCheck(findings);
}

main();
