/**
 * E2E tests for the lockfile refresh summary CLI.
 *
 * Drives the real `scripts/summarize-refresh.mjs` as a child process the way
 * `.github/workflows/lockfile-refresh.yml` runs it: two lockfile paths in,
 * one JSON object on stdout. The unit suite `tests/refresh-lockfile-logic.test.ts`
 * covers the policy in isolation; this suite proves the CLI hands that policy
 * the right inputs and publishes every field the workflow reads — above all
 * `majorBumps`, whose count decides whether a refresh may auto-merge.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../scripts/summarize-refresh.mjs', import.meta.url));
const MAJOR_SECTION = '## Major-version jumps';

/** Everything one CLI run produced. */
interface ICliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

let root: string;
let fileCount = 0;

/**
 * Writes a lockfile holding the given package entries to a fresh file.
 *
 * @param packages The `packages` map, keyed by install path.
 * @returns The path of the written lockfile.
 */
function writeLockfile(packages: Record<string, unknown>): string {
  const path = join(root, `package-lock-${++fileCount}.json`);
  writeFileSync(path, JSON.stringify({ name: 'root', lockfileVersion: 3, packages: { '': { name: 'root' }, ...packages } }));
  return path;
}

/**
 * Runs the summary CLI.
 *
 * @param args The command-line arguments.
 * @returns The exit status and both streams.
 */
function runCli(args: string[]): ICliRun {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'summarize-refresh-e2e-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('summarize-refresh CLI', () => {
  it('publishes a runtime major jump in majorBumps and the body', () => {
    const before = writeLockfile({
      'node_modules/sax': { version: '1.4.0' },
      'node_modules/vitest': { version: '3.0.0', dev: true },
    });
    const after = writeLockfile({
      'node_modules/sax': { version: '2.0.0' },
      'node_modules/vitest': { version: '3.0.1', dev: true },
    });

    const run = runCli([before, after]);

    expect(run.status).toBe(0);
    const summary = JSON.parse(run.stdout);
    expect(summary).toMatchObject({
      hasChanges: true,
      commitType: 'fix',
      title: 'fix(deps): refresh 1 runtime and 1 dev lockfile pins',
      majorBumps: [{ path: 'node_modules/sax', from: '1.4.0', to: '2.0.0' }],
    });
    expect(summary.body).toContain(`${MAJOR_SECTION} (1)`);
  });

  it('publishes an empty majorBumps list when every move stays inside its major', () => {
    const before = writeLockfile({ 'node_modules/vitest': { version: '3.0.0', dev: true } });
    const after = writeLockfile({ 'node_modules/vitest': { version: '3.2.4', dev: true } });

    const run = runCli([before, after]);

    expect(run.status).toBe(0);
    const summary = JSON.parse(run.stdout);
    expect(summary).toMatchObject({ hasChanges: true, commitType: 'chore', majorBumps: [] });
    expect(summary.body).not.toContain(MAJOR_SECTION);
  });

  it('reports no change for identical lockfiles', () => {
    const lockfile = writeLockfile({ 'node_modules/sax': { version: '1.4.0' } });

    const run = runCli([lockfile, lockfile]);

    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ hasChanges: false, majorBumps: [] });
  });

  it('fails without output when a lockfile cannot be read', () => {
    const before = writeLockfile({ 'node_modules/sax': { version: '1.4.0' } });

    const run = runCli([before, join(root, 'missing.json')]);

    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('Unable to read');
  });

  it('fails without output when a lockfile path is missing', () => {
    const run = runCli([writeLockfile({})]);

    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('Usage:');
  });
});
