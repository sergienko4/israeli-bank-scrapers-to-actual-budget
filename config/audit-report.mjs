/**
 * Runs `npm audit` against the committed dependency tree and flattens the
 * report into one record per advisory.
 *
 * Shared by the audit gate (config/check-audit.mjs) and the override-floor
 * planner (scripts/plan-override-floors.mjs), so both read the same findings.
 * Every run passes `--package-lock-only`: the audit reads package-lock.json, not
 * node_modules, so it can run in a job that installs nothing and it always
 * judges exactly what is committed.
 */

import { execFileSync } from 'node:child_process';

/**
 * Resolves how to invoke the npm CLI without going through a shell.
 *
 * npm scripts expose the CLI entry point as npm_execpath, so it can be run
 * directly with the current Node binary. That keeps the call free of shell
 * interpolation, which the repository's CodeQL rules require.
 *
 * @param {string[]} args Arguments to pass to npm.
 * @param {NodeJS.ProcessEnv} [env] Environment to read npm_execpath from.
 * @returns {{ command: string, args: string[] }} The command and arguments to spawn.
 */
export function npmInvocation(args, env = process.env) {
  const cli = env.npm_execpath;
  if (cli) return { command: process.execPath, args: [cli, ...args] };
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args };
}

/**
 * Parses an npm audit report and rejects anything that is not one.
 *
 * On operational failures (ENOLOCK, registry auth, network) npm still writes
 * valid JSON to stdout, but it carries an `error` object instead of findings.
 * Returning that would make the gate report success having audited nothing, so
 * a report with an `error` object, or without a vulnerabilities object, is
 * treated as a failed run — even an `error` beside an empty vulnerabilities
 * map, which would otherwise read as clean.
 *
 * Arrays are rejected too: `typeof [] === 'object'`, so an array would satisfy a
 * naive object check while yielding no findings, which is the same silent pass.
 * A real report keys vulnerabilities by package name, never by index.
 *
 * @param {string} stdout Raw stdout captured from npm audit.
 * @param {Error} [cause] The child-process error, when the run exited non-zero.
 * @returns {object} The validated audit report.
 */
export function parseAuditReport(stdout, cause) {
  const report = JSON.parse(stdout);
  const findings = report?.vulnerabilities;
  if (report?.error || !findings || typeof findings !== 'object' || Array.isArray(findings)) {
    throw cause ?? new Error('npm audit did not return a vulnerability report');
  }
  return report;
}

/**
 * Runs `npm audit --json --package-lock-only` and returns the parsed report.
 *
 * npm exits non-zero whenever it finds advisories, so a thrown error still
 * carries the report on stdout and is not itself a failure signal.
 *
 * @param {string[]} extraArgs Additional npm audit arguments.
 * @param {import('./audit-report.d.mts').NpmExec} [exec] Process runner, injectable for tests.
 * @returns {object} The parsed audit report.
 */
export function runAudit(extraArgs, exec = execFileSync) {
  const { command, args } = npmInvocation(['audit', '--json', '--package-lock-only', ...extraArgs]);
  try {
    return parseAuditReport(
      exec(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }),
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
export function toGhsaId(url) {
  return url?.split('/').pop() ?? url ?? 'unknown';
}

/**
 * Flattens an npm audit report into one record per distinct advisory.
 *
 * `range` is the vulnerable version range npm reports, or null when it omits
 * one; the override-floor planner refuses to act on a null range.
 *
 * @param {object} report The parsed npm audit report.
 * @returns {import('./audit-report.d.mts').IAuditAdvisory[]} The advisories.
 */
export function collectAdvisories(report) {
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
        range: via.range ?? null,
      });
    }
  }
  return [...advisories.values()];
}

/**
 * Audits the committed tree: every advisory, plus the packages that carry an
 * advisory inside the production (`--omit=dev`) tree.
 *
 * @param {import('./audit-report.d.mts').NpmExec} [exec] Process runner, injectable for tests.
 * @returns {import('./audit-report.d.mts').ICommittedTreeAudit} Both audit views.
 */
export function auditCommittedTree(exec = execFileSync) {
  const advisories = collectAdvisories(runAudit([], exec));
  const production = collectAdvisories(runAudit(['--omit=dev'], exec));
  return { advisories, productionPackages: new Set(production.map(advisory => advisory.package)) };
}
