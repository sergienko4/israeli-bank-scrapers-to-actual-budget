/**
 * E2E tests for the release-signal CI guard.
 *
 * Drives the real `scripts/check-release-signal.mjs` as a child process against
 * a disposable git repository, exercising the whole path CI takes: argument
 * parsing → `git show <base>:<path>` → policy evaluation → exit code. The unit
 * suite `tests/release-signal-logic.test.ts` covers the policy in isolation;
 * this suite proves the exit status a maintainer's PR is actually graded on.
 *
 * The guard resolves `package.json` and `Dockerfile` relative to its own
 * location and reads the base revision from `process.cwd()`, so the scripts are
 * copied into the fixture. That keeps the assertions off this repo's real
 * history, which changes under us every commit.
 *
 * Companion to `tests/e2e/coupling-scanner.e2e.test.ts`, whose temp-fixture and
 * subprocess conventions this file follows.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPTS = ['check-release-signal.mjs', 'release-signal-logic.mjs'];
const NODE_24 = 'node:24-slim@sha256:aaaa';
const NODE_26 = 'node:26-slim@sha256:bbbb';
const SCRAPER = '@sergienko4/israeli-bank-scrapers';

let root: string;
let baseSha: string;

/**
 * Runs a git command inside the fixture, failing loudly on a non-zero exit.
 *
 * @param args The git arguments to run.
 * @returns The trimmed stdout.
 */
function git(args: string[]): string {
  const res = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30_000 });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout.trim();
}

/**
 * Writes the fixture manifest and Dockerfile.
 *
 * @param scraperRange The scraper version range to record in `dependencies`.
 * @param baseImage The image reference to record in the Dockerfile `FROM`.
 */
function writeFixture(scraperRange: string, baseImage: string): void {
  const manifest = { name: 'fixture', version: '1.0.0', dependencies: { [SCRAPER]: scraperRange } };
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`);
  writeFileSync(join(root, 'Dockerfile'), `FROM ${baseImage}\nCMD ["node"]\n`);
}

/**
 * Runs the guard against the committed base revision.
 *
 * @param title The pull request title to grade.
 * @returns The exit status and combined output.
 */
function runGuard(title: string): { status: number | null; output: string } {
  const res = spawnSync(
    process.execPath,
    [join(root, 'scripts', 'check-release-signal.mjs'), '--title', title, '--base', baseSha],
    { cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (res.error) throw res.error;
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'release-signal-'));
  mkdirSync(join(root, 'scripts'));
  for (const name of SCRIPTS) {
    copyFileSync(fileURLToPath(new URL(`../../scripts/${name}`, import.meta.url)), join(root, 'scripts', name));
  }

  git(['init', '--quiet']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  writeFixture('^8.6.1', NODE_24);
  git(['add', '.']);
  git(['commit', '--quiet', '--no-verify', '-m', 'base']);
  baseSha = git(['rev-parse', 'HEAD']);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('check-release-signal CLI', () => {
  it('exits 0 when nothing shipped changed, whatever the title', () => {
    writeFixture('^8.6.1', NODE_24);
    const { status } = runGuard('chore(ci): unrelated tweak');
    expect(status).toBe(0);
  });

  it('exits 1 when a dependency bump carries a non-release title', () => {
    writeFixture('^8.7.0', NODE_24);
    const { status, output } = runGuard('chore(deps): bump scraper');
    expect(status).toBe(1);
    expect(output).toContain(`dependencies.${SCRAPER}`);
  });

  it('exits 0 when the same dependency bump carries a release title', () => {
    writeFixture('^8.7.0', NODE_24);
    const { status } = runGuard('fix(deps): bump scraper to 8.7.0');
    expect(status).toBe(0);
  });

  it('exits 1 when a base-image bump carries a non-release title', () => {
    writeFixture('^8.6.1', NODE_26);
    const { status, output } = runGuard('chore(docker): bump base image');
    expect(status).toBe(1);
    expect(output).toContain('Dockerfile.FROM');
  });

  it('exits 0 when the same base-image bump carries a release title', () => {
    writeFixture('^8.6.1', NODE_26);
    const { status } = runGuard('fix(docker): bump base image to node 26');
    expect(status).toBe(0);
  });

  it('fails closed when the base revision cannot be read', () => {
    writeFixture('^8.6.1', NODE_24);
    const res = spawnSync(
      process.execPath,
      [join(root, 'scripts', 'check-release-signal.mjs'), '--title', 'fix: x', '--base', 'deadbeef'],
      { cwd: root, encoding: 'utf8', timeout: 30_000 },
    );
    expect(res.status).toBe(1);
    expect(`${res.stdout}${res.stderr}`).toContain('Unable to read package.json');
  });
});
