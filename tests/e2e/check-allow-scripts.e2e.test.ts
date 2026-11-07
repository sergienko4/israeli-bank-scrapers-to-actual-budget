/**
 * E2E tests for the `allowScripts` gate CLI.
 *
 * Drives the real `scripts/check-allow-scripts.mjs` as a child process inside
 * a scratch repository. The CLI resolves package.json and package-lock.json
 * from its own location, so the script and its policy module are copied under
 * the scratch root and the lockfile is written by hand.
 *
 * `tests/allow-scripts-logic.test.ts` covers the rules; this suite covers what
 * only the process boundary can show: bytes written, bytes left alone, and the
 * exit status the workflows branch on.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPTS = ['check-allow-scripts.mjs', 'allow-scripts-logic.mjs'];

/** Everything one CLI run produced. */
interface ICliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

let root: string;

/**
 * Writes a scratch repository whose lockfile runs install scripts for the
 * given packages only.
 *
 * @param allowScripts The manifest's `allowScripts`, in the key order to keep.
 * @param scripted Locked `<name>@<version>` pairs that declare an install script.
 * @returns Nothing; the files are written into the scratch root.
 */
function writeRepo(allowScripts: Record<string, boolean>, scripted: string[]): void {
  mkdirSync(join(root, 'scripts'));
  for (const file of SCRIPTS) {
    copyFileSync(fileURLToPath(new URL(`../../scripts/${file}`, import.meta.url)), join(root, 'scripts', file));
  }
  const packages = Object.fromEntries(
    scripted.map(pin => {
      const at = pin.lastIndexOf('@');
      return [`node_modules/${pin.slice(0, at)}`, { version: pin.slice(at + 1), hasInstallScript: true }];
    })
  );
  const manifest = { name: 'root', version: '1.0.0', allowScripts };
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(root, 'package-lock.json'), `${JSON.stringify({ name: 'root', lockfileVersion: 3, packages: { '': {}, ...packages } }, null, 2)}\n`);
}

/**
 * Runs the CLI in the scratch repository.
 *
 * @param args The command-line arguments.
 * @returns The exit status and both streams.
 */
function runCli(args: string[]): ICliRun {
  const res = spawnSync(process.execPath, [join(root, 'scripts', 'check-allow-scripts.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/**
 * Reads the scratch manifest's raw bytes.
 *
 * @returns The package.json text.
 */
function manifestText(): string {
  return readFileSync(join(root, 'package.json'), 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-allow-scripts-e2e-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('check-allow-scripts --drop-orphans', () => {
  it('removes an approval the tree no longer needs, keeps the rest in order and reports it', () => {
    writeRepo({ 'a@1.0.0': true, 'gone@2.0.0': true, 'z@3.0.0': true }, ['a@1.0.0', 'z@3.0.0']);

    const run = runCli(['--drop-orphans']);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('orphan pin: gone@2.0.0 no longer needs an install script');
    expect(JSON.parse(manifestText()).allowScripts).toEqual({ 'a@1.0.0': true, 'z@3.0.0': true });
    expect(Object.keys(JSON.parse(manifestText()).allowScripts)).toEqual(['a@1.0.0', 'z@3.0.0']);
  });

  it('leaves package.json byte-identical when no approval is orphaned', () => {
    writeRepo({ 'a@1.0.0': true }, ['a@1.0.0']);
    const before = manifestText();

    const run = runCli(['--drop-orphans']);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('No orphan allowScripts pins to drop.');
    expect(manifestText()).toBe(before);
  });

  it('never rotates a stale pin, so a new install script still waits for a human', () => {
    writeRepo({ 'a@1.0.0': true, 'gone@2.0.0': true }, ['a@1.1.0']);

    const run = runCli(['--drop-orphans']);

    expect(run.status).toBe(0);
    expect(run.stdout).not.toContain('stale pin');
    expect(JSON.parse(manifestText()).allowScripts).toEqual({ 'a@1.0.0': true });
  });

  it('never approves a package that is not on the allowlist', () => {
    writeRepo({ 'gone@2.0.0': true }, ['fresh@1.0.0']);

    const run = runCli(['--drop-orphans']);

    expect(run.status).toBe(0);
    expect(JSON.parse(manifestText()).allowScripts).toEqual({});
  });

  it('is idempotent', () => {
    writeRepo({ 'a@1.0.0': true, 'gone@2.0.0': true }, ['a@1.0.0']);
    runCli(['--drop-orphans']);
    const once = manifestText();

    runCli(['--drop-orphans']);

    expect(manifestText()).toBe(once);
  });

  it('fails without writing when an allowlist entry is not an exact pin', () => {
    writeRepo({ 'a@1.0.0': true, 'gone@^2.0.0': true }, ['a@1.0.0']);
    const before = manifestText();

    const run = runCli(['--drop-orphans']);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('allowScripts entry "gone@^2.0.0"');
    expect(manifestText()).toBe(before);
  });
});

describe('check-allow-scripts default mode', () => {
  it('still fails on an orphaned approval, so the gate itself is unchanged', () => {
    writeRepo({ 'a@1.0.0': true, 'gone@2.0.0': true }, ['a@1.0.0']);

    const run = runCli([]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('orphan pin: gone@2.0.0 no longer needs an install script');
  });
});
