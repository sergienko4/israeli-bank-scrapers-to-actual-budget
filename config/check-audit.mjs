/**
 * Dependency vulnerability enforcement script.
 *
 * Replaces a bare `npm audit --audit-level=moderate` so a single unfixable
 * advisory cannot block every release while still failing on everything else.
 *
 * Checks:
 * 1. Every advisory at or above the enforced severity is either fixed or
 *    covered by an unexpired entry in config/audit-policy.mjs.
 * 2. No accepted entry applies to a package that reaches the production tree.
 *
 * Run via: npm run audit
 */

import { execFileSync } from 'node:child_process';

import { AUDIT_LEVEL, classifyAdvisories } from './audit-policy.mjs';

/**
 * Resolves how to invoke the npm CLI without going through a shell.
 *
 * npm scripts expose the CLI entry point as npm_execpath, so it can be run
 * directly with the current Node binary. That keeps the call free of shell
 * interpolation, which the repository's CodeQL rules require.
 *
 * @param {string[]} args Arguments to pass to npm.
 * @returns {{ command: string, args: string[] }} The command and arguments to spawn.
 */
function npmInvocation(args) {
  const cli = process.env.npm_execpath;
  if (cli) return { command: process.execPath, args: [cli, ...args] };
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args };
}

/**
 * Parses an npm audit report and rejects anything that is not one.
 *
 * On operational failures (ENOLOCK, registry auth, network) npm still writes
 * valid JSON to stdout, but it carries an `error` object instead of findings.
 * Returning that would make the gate report success having audited nothing, so
 * a report without a vulnerabilities object is treated as a failed run.
 *
 * @param {string} stdout Raw stdout captured from npm audit.
 * @param {Error} [cause] The child-process error, when the run exited non-zero.
 * @returns {object} The validated audit report.
 */
function parseAuditReport(stdout, cause) {
  const report = JSON.parse(stdout);
  if (!report?.vulnerabilities || typeof report.vulnerabilities !== 'object') {
    throw cause ?? new Error('npm audit did not return a vulnerability report');
  }
  return report;
}

/**
 * Runs `npm audit --json` and returns the parsed report.
 *
 * npm exits non-zero whenever it finds advisories, so a thrown error still
 * carries the report on stdout and is not itself a failure signal.
 *
 * @param {string[]} extraArgs Additional npm audit arguments.
 * @returns {object} The parsed audit report.
 */
function runAudit(extraArgs) {
  const { command, args } = npmInvocation(['audit', '--json', ...extraArgs]);
  try {
    return parseAuditReport(
      execFileSync(command, args, {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  } catch (error) {
    const stdout = error?.stdout;
    if (!stdout) throw error;
    return parseAuditReport(stdout, error);
  }
}

/**
 * Extracts the GitHub advisory identifier from an advisory URL.
 *
 * @param {string} url The advisory URL reported by npm audit.
 * @returns {string} The GHSA identifier, or the URL when it cannot be parsed.
 */
function toGhsaId(url) {
  return url?.split('/').pop() ?? url ?? 'unknown';
}

/**
 * Flattens an npm audit report into one record per distinct advisory.
 *
 * @param {object} report The parsed npm audit report.
 * @returns {Array<{ ghsa: string, package: string, severity: string, title: string }>} The advisories.
 */
function collectAdvisories(report) {
  const advisories = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== 'object') continue;
      const ghsa = toGhsaId(via.url);
      advisories.set(`${via.name}::${ghsa}`, {
        ghsa,
        package: via.name,
        severity: via.severity ?? 'unknown',
        title: via.title ?? 'no title reported',
      });
    }
  }
  return [...advisories.values()];
}

/**
 * Lists packages carrying advisories in the production dependency tree.
 *
 * @returns {Set<string>} Names of production packages with advisories.
 */
function readProductionPackages() {
  const report = runAudit(['--omit=dev']);
  return new Set(collectAdvisories(report).map(advisory => advisory.package));
}

const advisories = collectAdvisories(runAudit([]));
const { violations, accepted } = classifyAdvisories(advisories, readProductionPackages());

for (const entry of accepted) {
  console.log(`⚠️  Accepted ${entry.ghsa} (${entry.package}, ${entry.severity}) until ${entry.expires}`);
  console.log(`    ${entry.reason}`);
}

if (violations.length > 0) {
  console.error(`❌ ${violations.length} unaddressed advisory(ies) at or above "${AUDIT_LEVEL}":`);
  for (const violation of violations) {
    console.error(`  - ${violation.ghsa} ${violation.package} (${violation.severity}) — ${violation.why}`);
    console.error(`    ${violation.title}`);
  }
  console.error('Fix them, or add a justified entry to config/audit-policy.mjs.');
  process.exit(1);
}

console.log(`✅ No unaddressed advisories at or above "${AUDIT_LEVEL}" (${accepted.length} accepted).`);
