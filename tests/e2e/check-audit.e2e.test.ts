/**
 * E2E tests for the audit gate's exit-code contract.
 *
 * Drives the real `config/check-audit.mjs` as a child process the way
 * `npm run audit` and the workflows run it. npm itself is replaced through
 * `npm_execpath` (the hook `config/audit-report.mjs` uses to find the CLI) by a
 * stub that replays canned reports, so the suite is offline and deterministic.
 *
 * The contract matters because the 4-hourly advisory watch and the Dependabot
 * triage act only on exit 1: a registry outage (exit 2) must never look like a
 * finding, and a finding must never look like an outage.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../config/check-audit.mjs', import.meta.url));

/**
 * The npm stand-in: prints the report named by the audit's flags, records the
 * flags it saw, and exits the way npm does (1 when anything is vulnerable).
 */
const FAKE_NPM = `
const { appendFileSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_NPM_LOG, args.join(' ') + '\\n');
const text = readFileSync(args.includes('--omit=dev') ? process.env.FAKE_NPM_PROD : process.env.FAKE_NPM_FULL, 'utf8');
process.stdout.write(text);
const report = JSON.parse(text);
process.exit(report.error || Object.keys(report.vulnerabilities ?? {}).length > 0 ? 1 : 0);
`;

const VULNERABLE = {
  re2js: {
    via: [
      {
        name: 're2js',
        url: 'https://github.com/advisories/GHSA-gg6h-894w-4m9c',
        severity: 'high',
        title: 'Quadratic-time denial of service',
        range: '>=2.2.0 <2.8.7',
      },
    ],
  },
};

/** Everything one gate run produced. */
interface IGateRun {
  status: number | null;
  stdout: string;
  stderr: string;
  npmCalls: string[];
}

let root: string;
let runCount = 0;

/**
 * Runs the gate against canned full and production reports.
 *
 * @param full The report the full audit prints.
 * @param production The report the `--omit=dev` audit prints.
 * @returns The exit status, both streams and the npm arguments seen.
 */
function runGate(full: object, production: object): IGateRun {
  const id = ++runCount;
  const paths = { full: join(root, `full-${id}.json`), prod: join(root, `prod-${id}.json`), log: join(root, `npm-${id}.log`) };
  writeFileSync(paths.full, JSON.stringify(full));
  writeFileSync(paths.prod, JSON.stringify(production));
  writeFileSync(paths.log, '');
  const env = { ...process.env, npm_execpath: join(root, 'fake-npm.cjs'), FAKE_NPM_FULL: paths.full, FAKE_NPM_PROD: paths.prod, FAKE_NPM_LOG: paths.log };
  const res = spawnSync(process.execPath, [CLI], { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
  if (res.error) throw res.error;
  const npmCalls = readFileSync(paths.log, 'utf8').trim().split('\n');
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, npmCalls };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'check-audit-e2e-'));
  writeFileSync(join(root, 'fake-npm.cjs'), FAKE_NPM);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('check-audit exit codes', () => {
  it('exits 0 on a clean tree, auditing the lockfile only', () => {
    const run = runGate({ vulnerabilities: {} }, { vulnerabilities: {} });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('✅ No unaddressed advisories at or above "moderate"');
    expect(run.npmCalls).toEqual(['audit --json --package-lock-only', 'audit --json --package-lock-only --omit=dev']);
  });

  it('exits 1 on an unaccepted advisory and names it', () => {
    const run = runGate({ vulnerabilities: VULNERABLE }, { vulnerabilities: {} });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('GHSA-gg6h-894w-4m9c re2js (high) — no accepted-advisory entry');
  });

  it('exits 2 when npm reports an error object instead of findings', () => {
    const run = runGate({ error: { code: 'EAI_AGAIN', summary: 'registry unreachable' } }, { vulnerabilities: {} });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('npm audit could not produce a report');
    expect(run.stdout).not.toContain('✅');
  });
});
