/**
 * E2E tests for the override-floor CLI.
 *
 * Drives the real `scripts/plan-override-floors.mjs` as a child process in a
 * scratch project, the way `.github/workflows/lockfile-refresh.yml` runs it.
 * npm is replaced through `npm_execpath` by a stub that models the three
 * things the CLI relies on: `audit` flags a locked version listed as
 * vulnerable, `view` returns canned publish times, and `update` moves a locked
 * version according to whether an override is present. Every npm call is
 * logged, so the suite also proves nothing outside the allow-list ever runs.
 *
 * The unit suite `tests/override-floor-logic.test.ts` covers the rules; this
 * suite covers what only the process boundary can show: files written,
 * restored on a failed floor, and left byte-identical when pruning is a no-op.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../scripts/plan-override-floors.mjs', import.meta.url));
const OLD = '2026-01-01T00:00:00.000Z';

/**
 * The npm stand-in. State comes from fake-npm-state.json in the project:
 * `advisories` (name, ghsa, range, vulnerable versions), `times` per package,
 * and `resolve` per package (the version `update` locks with and without an
 * override, plus `also`: other packages the overridden release relocks). A
 * package listed in `ineffective` ignores its override.
 */
const FAKE_NPM = `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('npm-calls.log', args.join(' ') + '\\n');
const state = JSON.parse(fs.readFileSync('fake-npm-state.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const commands = {
  audit() {
    const vulnerabilities = {};
    for (const a of state.advisories) {
      const hit = Object.entries(lock.packages).some(([path, entry]) =>
        path.endsWith('node_modules/' + a.name) && a.vulnerable.includes(entry.version) && !(args.includes('--omit=dev') && entry.dev));
      if (hit) vulnerabilities[a.name] = { via: [{ name: a.name, url: 'https://github.com/advisories/' + a.ghsa, severity: 'high', title: 't', range: a.range }] };
    }
    process.stdout.write(JSON.stringify({ auditReportVersion: 2, vulnerabilities }));
    return Object.keys(vulnerabilities).length > 0 ? 1 : 0;
  },
  view() {
    const times = state.times[args[1]];
    if (!times) { process.stderr.write('E404'); return 1; }
    process.stdout.write(JSON.stringify(times));
    return 0;
  },
  update() {
    const overrides = JSON.parse(fs.readFileSync('package.json', 'utf8')).overrides ?? {};
    for (const name of args.slice(1).filter(arg => !arg.startsWith('-'))) {
      if ((state.ineffective ?? []).includes(name)) continue;
      const pick = state.resolve[name];
      lock.packages['node_modules/' + name].version = overrides[name] ? pick.withOverride : pick.withoutOverride;
      for (const [dep, version] of Object.entries(overrides[name] ? pick.also ?? {} : {})) lock.packages['node_modules/' + dep].version = version;
    }
    fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\\n');
    return 0;
  },
};
process.exit(commands[args[0]] ? commands[args[0]]() : 99);
`;

/** Everything one CLI run produced. */
interface ICliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** The fake registry and resolver for one scenario. */
interface IFakeState {
  advisories: Array<{ name: string; ghsa: string; range: string; vulnerable: string[] }>;
  times: Record<string, Record<string, string>>;
  resolve: Record<string, { withOverride: string; withoutOverride: string; also?: Record<string, string> }>;
  ineffective?: string[];
}

let root: string;

/**
 * Writes a scratch project: manifest, lockfile, fake npm and its state.
 *
 * @param overrides The manifest's `overrides`.
 * @param locked Locked version per package, all top-level dev copies.
 * @param state The fake npm's state.
 * @returns Nothing; the files are written into the project root.
 */
function writeProject(overrides: Record<string, string>, locked: Record<string, string>, state: IFakeState): void {
  const manifest = { name: 'root', version: '1.0.0', devDependencies: { tool: '^1.0.0' }, overrides };
  const packages = Object.fromEntries(Object.entries(locked).map(([name, version]) => [`node_modules/${name}`, { version, dev: true }]));
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(root, 'package-lock.json'), `${JSON.stringify({ name: 'root', lockfileVersion: 3, packages: { '': {}, ...packages } }, null, 2)}\n`);
  writeFileSync(join(root, 'fake-npm.cjs'), FAKE_NPM);
  writeFileSync(join(root, 'fake-npm-state.json'), JSON.stringify(state));
  writeFileSync(join(root, 'npm-calls.log'), '');
}

/**
 * Runs the CLI in the scratch project.
 *
 * @param args The command-line arguments.
 * @returns The exit status and both streams.
 */
function runCli(args: string[]): ICliRun {
  const env = { ...process.env, npm_execpath: join(root, 'fake-npm.cjs') };
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/**
 * Reads a project file.
 *
 * @param name The file name.
 * @returns Its contents.
 */
function read(name: string): string {
  return readFileSync(join(root, name), 'utf8');
}

/**
 * Lists the npm calls the CLI made.
 *
 * @returns One argument string per call.
 */
function npmCalls(): string[] {
  return read('npm-calls.log').trim().split('\n').filter(Boolean);
}

/**
 * Builds a vulnerable package fixed one patch later, with an aged fix.
 *
 * @param name The package name.
 * @param ghsa Its advisory id.
 * @returns The fake state entries for the package.
 */
function vulnerablePackage(name: string, ghsa: string): Pick<IFakeState, 'advisories' | 'times' | 'resolve'> {
  return {
    advisories: [{ name, ghsa, range: '<1.0.1', vulnerable: ['1.0.0'] }],
    times: { [name]: { created: OLD, '1.0.0': OLD, '1.0.1': OLD } },
    resolve: { [name]: { withOverride: '1.0.1', withoutOverride: '1.0.0' } },
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'plan-override-floors-e2e-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('plan-override-floors --apply', () => {
  it('writes the floor, regenerates under the release-age window and runs nothing outside the allow-list', () => {
    writeProject({ katex: '^0.18.2' }, { re2js: '1.0.0' }, vulnerablePackage('re2js', 'GHSA-gg6h-894w-4m9c'));

    const run = runCli(['--apply']);

    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ floors: [{ package: 're2js', floor: '^1.0.1', kind: 'in-line' }], rejections: [], requiresReview: false });
    expect(JSON.parse(read('package.json')).overrides).toEqual({ katex: '^0.18.2', re2js: '^1.0.1' });
    expect(JSON.parse(read('package-lock.json')).packages['node_modules/re2js'].version).toBe('1.0.1');
    expect(npmCalls()).toContain('update re2js --package-lock-only --ignore-scripts --min-release-age=3 --min-release-age-exclude=@sergienko4/israeli-bank-scrapers');
    expect(npmCalls().every(call => /^(audit|view|update) /.test(call))).toBe(true);
  });

  it('drops a floor that leaves its advisory in place and keeps the one that works', () => {
    const good = vulnerablePackage('good', 'GHSA-good-good-good');
    const bad = vulnerablePackage('bad', 'GHSA-badd-badd-badd');
    writeProject({}, { good: '1.0.0', bad: '1.0.0' }, {
      advisories: [...good.advisories, ...bad.advisories],
      times: { ...good.times, ...bad.times },
      resolve: { ...good.resolve, ...bad.resolve },
      ineffective: ['bad'],
    });

    const run = runCli(['--apply']);

    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      floors: [{ package: 'good' }],
      rejections: [{ package: 'bad', ghsas: ['GHSA-badd-badd-badd'], reason: 'floor-ineffective' }],
      requiresReview: true,
    });
    expect(JSON.parse(read('package.json')).overrides).toEqual({ good: '^1.0.1' });
    expect(npmCalls().filter(call => call.startsWith('update '))).toEqual([
      expect.stringMatching(/^update bad good /),
      expect.stringMatching(/^update good /),
    ]);
  });

  it('leaves both files byte-identical when the only floor is ineffective', () => {
    writeProject({}, { bad: '1.0.0' }, { ...vulnerablePackage('bad', 'GHSA-badd-badd-badd'), ineffective: ['bad'] });
    const before = { manifest: read('package.json'), lock: read('package-lock.json') };

    const run = runCli(['--apply']);

    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ floors: [], rejections: [{ reason: 'floor-ineffective' }] });
    expect({ manifest: read('package.json'), lock: read('package-lock.json') }).toEqual(before);
  });

  it('drops a floor that npm resolves above, into an advisory the plan never saw', () => {
    const drift = vulnerablePackage('drift', 'GHSA-drft-drft-drft');
    writeProject({}, { drift: '1.0.0' }, {
      advisories: [...drift.advisories, { name: 'drift', ghsa: 'GHSA-newr-newr-newr', range: '>=1.0.2 <1.0.3', vulnerable: ['1.0.2'] }],
      times: { drift: { ...drift.times.drift, '1.0.2': OLD } },
      resolve: { drift: { withOverride: '1.0.2', withoutOverride: '1.0.0' } },
    });
    const before = { manifest: read('package.json'), lock: read('package-lock.json') };

    const run = runCli(['--apply']);

    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      floors: [],
      rejections: [{ package: 'drift', ghsas: ['GHSA-drft-drft-drft'], reason: 'floor-ineffective' }],
      requiresReview: true,
    });
    expect({ manifest: read('package.json'), lock: read('package-lock.json') }).toEqual(before);
  });

  it('drops a floor whose release pulls a new blocking advisory onto another package', () => {
    const host = vulnerablePackage('host', 'GHSA-host-host-host');
    writeProject({}, { host: '1.0.0', dep: '1.0.0' }, {
      advisories: [...host.advisories, { name: 'dep', ghsa: 'GHSA-depp-depp-depp', range: '>=2.0.0', vulnerable: ['2.0.0'] }],
      times: host.times,
      resolve: { host: { ...host.resolve.host, also: { dep: '2.0.0' } } },
    });
    const before = { manifest: read('package.json'), lock: read('package-lock.json') };

    const run = runCli(['--apply']);

    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      floors: [],
      rejections: [{ package: 'host', ghsas: ['GHSA-host-host-host'], reason: 'floor-ineffective' }],
      requiresReview: true,
    });
    expect({ manifest: read('package.json'), lock: read('package-lock.json') }).toEqual(before);
  });

  it('keeps a floor when the only other blocking advisory was already in the tree', () => {
    const good = vulnerablePackage('good', 'GHSA-good-good-good');
    const gone = vulnerablePackage('gone', 'GHSA-gone-gone-gone');
    writeProject({}, { good: '1.0.0', gone: '1.0.0' }, {
      advisories: [...good.advisories, ...gone.advisories],
      times: good.times,
      resolve: good.resolve,
    });

    const run = runCli(['--apply']);

    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      floors: [{ package: 'good' }],
      rejections: [{ package: 'gone', reason: 'missing-publish-times' }],
    });
    expect(JSON.parse(read('package.json')).overrides).toEqual({ good: '^1.0.1' });
  });

  it('clears a rejection once a surviving floor relocks that package past its advisory', () => {
    const host = vulnerablePackage('host', 'GHSA-host-host-host');
    const dep = vulnerablePackage('dep', 'GHSA-depp-depp-depp');
    writeProject({}, { host: '1.0.0', dep: '1.0.0' }, {
      advisories: [...host.advisories, ...dep.advisories],
      times: host.times,
      resolve: { host: { ...host.resolve.host, also: { dep: '1.0.1' } } },
    });

    const run = runCli(['--apply']);

    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ floors: [{ package: 'host' }], rejections: [], requiresReview: false });
    expect(JSON.parse(read('package-lock.json')).packages['node_modules/dep'].version).toBe('1.0.1');
  });
});

describe('plan-override-floors --check', () => {
  it('rejects a package whose publish times npm cannot report, writing nothing', () => {
    writeProject({}, { gone: '1.0.0' }, { ...vulnerablePackage('gone', 'GHSA-gone-gone-gone'), times: {} });
    const manifest = read('package.json');

    const run = runCli(['--check']);

    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout).rejections).toEqual([{ package: 'gone', ghsas: ['GHSA-gone-gone-gone'], reason: 'missing-publish-times' }]);
    expect(read('package.json')).toBe(manifest);
    expect(npmCalls().some(call => call.startsWith('update'))).toBe(false);
  });
});

describe('plan-override-floors --prune', () => {
  it('removes only the no-op override and restores the lockfile text', () => {
    writeProject({ noop: '^2.0.0', needed: '^1.0.1' }, { noop: '2.0.0', needed: '1.0.1' }, {
      advisories: [],
      times: {},
      resolve: { noop: { withOverride: '2.0.0', withoutOverride: '2.0.0' }, needed: { withOverride: '1.0.1', withoutOverride: '1.0.0' } },
    });
    const lock = read('package-lock.json');

    const run = runCli(['--prune']);

    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ pruned: ['noop'], kept: [{ package: 'needed', reason: 'changes-locked-versions' }] });
    expect(JSON.parse(read('package.json')).overrides).toEqual({ needed: '^1.0.1' });
    expect(read('package-lock.json')).toBe(lock);
  });

  it('keeps an exact pin even when removing it would change nothing today', () => {
    writeProject({ capped: '2.0.0' }, { capped: '2.0.0' }, {
      advisories: [],
      times: {},
      resolve: { capped: { withOverride: '2.0.0', withoutOverride: '2.0.0' } },
    });
    const manifest = read('package.json');

    const run = runCli(['--prune']);

    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ pruned: [], kept: [{ package: 'capped', reason: 'not-a-floor' }] });
    expect(read('package.json')).toBe(manifest);
    expect(npmCalls().some(call => call.startsWith('update'))).toBe(false);
  });
});

describe('plan-override-floors --verify-manifest', () => {
  it('fails when package.json changed outside the planned overrides', () => {
    writeProject({}, {}, { advisories: [], times: {}, resolve: {} });
    writeFileSync(join(root, 'before.json'), read('package.json'));
    writeFileSync(join(root, 'plan.json'), JSON.stringify({ floors: [{ package: 're2js' }] }));
    const edited = { ...JSON.parse(read('package.json')), scripts: { postinstall: 'node evil.js' } };
    writeFileSync(join(root, 'package.json'), JSON.stringify(edited));

    const run = runCli(['--verify-manifest', 'before.json', '--plan', 'plan.json']);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('a field outside "overrides" changed');
  });
});
