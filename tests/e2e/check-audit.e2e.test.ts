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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { ACCEPTED_ADVISORIES } from '../../config/audit-policy.mjs';
import { autoExtendingEntries, pastExpiryMs, writeFrozenClock } from '../helpers/autoExtendClock.js';

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

/** How one gate run departs from the defaults. */
interface IGateOptions {
  /** The `package-lock.json` the gate reads; omitted means no lockfile. */
  lock?: object;
  /** Extra `node` arguments placed before the CLI, such as a clock preload. */
  nodeArgs?: string[];
}

let root: string;
let runCount = 0;

/**
 * Creates the working directory for one gate run.
 *
 * Each run gets its own directory, so a lockfile written for one case never
 * leaks into another. Without a lockfile the gate sees no locked packages.
 *
 * @param id The run number.
 * @param lock The `package-lock.json` to write, if any.
 * @returns The directory's path.
 */
function makeRunDir(id: number, lock?: object): string {
  const dir = join(root, `run-${id}`);
  mkdirSync(dir);
  if (lock !== undefined) writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
  return dir;
}

/**
 * Runs the gate against canned full and production reports.
 *
 * @param full The report the full audit prints.
 * @param production The report the `--omit=dev` audit prints.
 * @param options The lockfile and extra `node` arguments for this run.
 * @returns The exit status, both streams and the npm arguments seen.
 */
function runGate(full: object, production: object, options: IGateOptions = {}): IGateRun {
  const id = ++runCount;
  const paths = { full: join(root, `full-${id}.json`), prod: join(root, `prod-${id}.json`), log: join(root, `npm-${id}.log`) };
  writeFileSync(paths.full, JSON.stringify(full));
  writeFileSync(paths.prod, JSON.stringify(production));
  writeFileSync(paths.log, '');
  const env = { ...process.env, npm_execpath: join(root, 'fake-npm.cjs'), FAKE_NPM_FULL: paths.full, FAKE_NPM_PROD: paths.prod, FAKE_NPM_LOG: paths.log };
  const res = spawnSync(process.execPath, [...(options.nodeArgs ?? []), CLI], { cwd: makeRunDir(id, options.lock), env, encoding: 'utf8', timeout: 30_000 });
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

describe('check-audit warnings', () => {
  it('flags every acceptance a clean tree no longer needs, and still exits 0', () => {
    const run = runGate({ vulnerabilities: {} }, { vulnerabilities: {} });
    const unusedLines = run.stdout.split(/\r?\n/).filter(line => line.includes('is no longer reported by npm audit'));

    expect(run.status).toBe(0);
    expect(unusedLines).toEqual(ACCEPTED_ADVISORIES.map(
      entry => `::warning::${entry.ghsa} (${entry.package}) is no longer reported by npm audit; `
        + 'remove its entry from config/audit-policy.mjs.',
    ));
  });
});

describe.each(autoExtendingEntries())("check-audit past the $package acceptance's expiry", entry => {
  // The clock is frozen inside the gate's process, a day and a half past the
  // shipped entry's expiry, so these cases run the date the gate will
  // actually face rather than today's. The suite is built from a table, so
  // a tree that ships no auto-extending entry registers none instead of
  // failing the whole file.
  const { ghsa, package: pkg, expires } = entry;
  const { fixedIn } = entry.autoExtend;
  const full = {
    vulnerabilities: {
      [pkg]: { via: [{ name: pkg, url: `https://github.com/advisories/${ghsa}`, severity: 'moderate', title: 'Expired acceptance', range: `<${fixedIn}` }] },
    },
  };
  const holderLock = {
    lockfileVersion: 3,
    packages: {
      '': {},
      [`node_modules/holds-${pkg}`]: { version: '1.0.0', dev: true, dependencies: { [pkg]: `<${fixedIn}` } },
      // The copy the holder resolves to. Without an installed copy below the
      // fix, the holder blocks nothing.
      [`node_modules/${pkg}`]: { version: '0.0.0', dev: true },
    },
  };
  let pastExpiry: string[];

  beforeAll(() => {
    pastExpiry = writeFrozenClock(root, pastExpiryMs(expires));
  });

  it('accepts the advisory and warns while a locked package still blocks the fix', () => {
    const run = runGate(full, { vulnerabilities: {} }, { lock: holderLock, nodeArgs: pastExpiry });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`Accepted ${ghsa} (${pkg}, moderate) past ${expires} (auto-extended)`);
    expect(run.stdout).toContain(
      `::warning::${ghsa} (${pkg}) acceptance expired on ${expires}; auto-extended while holds-${pkg}@1.0.0 cannot take ${pkg} ${fixedIn}.`,
    );
    // The advisory is still reported, so the acceptance is in use. Warning that
    // it is gone would send someone to delete the entry that keeps the gate green.
    expect(run.stdout).not.toContain(`::warning::${ghsa} (${pkg}) is no longer reported by npm audit`);
  });

  it('exits 1 once no locked package blocks the fix', () => {
    const run = runGate(full, { vulnerabilities: {} }, { nodeArgs: pastExpiry });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      `${ghsa} ${pkg} (moderate) — exception expired on ${expires}; it auto-extends only while a locked package blocks ${pkg} ${fixedIn}, and none does`,
    );
  });
});
