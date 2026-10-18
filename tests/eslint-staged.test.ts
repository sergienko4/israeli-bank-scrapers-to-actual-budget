/**
 * Runs scripts/eslint-staged.sh, the commit-stage ESLint gate, in a
 * throwaway git repository with a fake `npx` that records each call.
 *
 * Staged src/ TypeScript must reach the main ESLint config and staged
 * portal JavaScript the portal-public config. Unstaged, deleted and
 * out-of-scope files must not be linted, a staged path missing from the
 * working tree must be skipped rather than crash ESLint, an empty set must
 * be skipped, and an ESLint failure must fail the gate.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/eslint-staged.sh');
const PORTAL_CONFIG = 'config/eslint.portal-public.mjs';

/** Records each npx call as its arguments followed by an end marker. */
const FAKE_NPX = [
  '#!/usr/bin/env bash',
  'for arg in "$@"; do printf "%s\\n" "$arg" >> "$NPX_LOG"; done',
  'echo "<end>" >> "$NPX_LOG"',
  'exit "${NPX_EXIT:-0}"',
].join('\n');

/** One recorded npx call. */
interface INpxCall {
  readonly args: readonly string[];
}

/** Outcome of one gate run. */
interface IGateRun {
  readonly status: number | null;
  readonly output: string;
  readonly calls: readonly INpxCall[];
}

let repo = '';
let npxLog = '';
let fakeBin = '';

/** Environment without the caller's git variables, so git targets `repo`. */
const childEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));

/**
 * Runs git in the throwaway repository and fails the test on error.
 * @param args - git arguments.
 */
function git(...args: string[]): void {
  const run = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo,
    env: childEnv(),
    encoding: 'utf8',
  });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
}

/**
 * Writes a file in the throwaway repository.
 * @param relPath - Path relative to the repository root.
 * @param content - File content.
 */
function writeRepoFile(relPath: string, content = 'export const x = 1;\n'): void {
  const filePath = join(repo, relPath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

/**
 * Splits the fake npx log into calls.
 * @returns Recorded calls in order.
 */
function readCalls(): INpxCall[] {
  const lines = readFileSync(npxLog, 'utf8').split('\n');
  const calls: INpxCall[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line === '<end>') {
      calls.push({ args: current });
      current = [];
    } else if (line !== '') {
      current.push(line);
    }
  }
  return calls;
}

/**
 * Runs the gate the way the commit hook does.
 * @param npxExit - Exit code the fake npx returns.
 * @returns Exit status, output and recorded npx calls.
 */
function runGate(npxExit = 0): IGateRun {
  const env = {
    ...childEnv(),
    PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
    NPX_LOG: npxLog,
    NPX_EXIT: String(npxExit),
  };
  const run = spawnSync('bash', [SCRIPT], { cwd: repo, env, encoding: 'utf8' });
  return { status: run.status, output: `${run.stdout}${run.stderr}`, calls: readCalls() };
}

/**
 * Returns the files passed after `--` in an npx call.
 * @param call - Recorded call.
 * @returns The linted paths.
 */
const lintedFiles = (call: INpxCall): string[] => call.args.slice(call.args.indexOf('--') + 1);

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'eslint-staged-'));
  repo = join(base, 'repo');
  fakeBin = join(base, 'bin');
  npxLog = join(base, 'npx.log');
  mkdirSync(repo);
  mkdirSync(fakeBin);
  writeFileSync(npxLog, '');
  writeFileSync(join(fakeBin, 'npx'), FAKE_NPX);
  chmodSync(join(fakeBin, 'npx'), 0o755);
  git('init', '-q');
});

afterEach(() => {
  rmSync(dirname(repo), { recursive: true, force: true });
});

describe('eslint-staged.sh', () => {
  it('skips both configs when nothing is staged', () => {
    const run = runGate();
    expect(run.status).toBe(0);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain('ESLint: skipped (no staged src TS files)');
    expect(run.output).toContain('Portal ESLint: skipped (no staged portal JS files)');
  });

  it('routes staged src TS to the main config and portal JS to the portal config', () => {
    for (const path of ['src/A.ts', 'src/Deep/B.ts', 'src/With Space.ts', 'src/Portal/Public/app.js']) {
      writeRepoFile(path);
    }
    for (const path of ['src/Other.js', 'tests/T.ts', 'docs/x.md']) writeRepoFile(path);
    git('add', '-A');

    const run = runGate();

    expect(run.status).toBe(0);
    expect(run.calls).toHaveLength(2);
    const [main, portal] = run.calls;
    expect(main.args).not.toContain('--config');
    expect(lintedFiles(main)).toEqual(['src/A.ts', 'src/Deep/B.ts', 'src/With Space.ts']);
    expect(portal.args).toContain(PORTAL_CONFIG);
    expect(lintedFiles(portal)).toEqual(['src/Portal/Public/app.js']);
  });

  it('skips the main config when only docs are staged', () => {
    writeRepoFile('docs/x.md', '# x\n');
    git('add', '-A');
    const run = runGate();
    expect(run.status).toBe(0);
    expect(run.calls).toEqual([]);
  });

  it('lints renamed files and ignores deleted and unstaged ones', () => {
    for (const path of ['src/Old.ts', 'src/Gone.ts', 'src/Edited.ts']) writeRepoFile(path);
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'seed');
    git('mv', 'src/Old.ts', 'src/New.ts');
    git('rm', '-q', 'src/Gone.ts');
    writeRepoFile('src/Edited.ts', 'export const x = 2;\n');

    const run = runGate();

    expect(run.calls).toHaveLength(1);
    expect(lintedFiles(run.calls[0])).toEqual(['src/New.ts']);
  });

  it('skips a staged path deleted from the working tree', () => {
    for (const path of ['src/A.ts', 'src/Portal/Public/app.js']) writeRepoFile(path);
    git('add', '-A');
    rmSync(join(repo, 'src/Portal/Public/app.js'));

    const run = runGate();

    expect(run.status).toBe(0);
    expect(run.calls).toHaveLength(1);
    expect(lintedFiles(run.calls[0])).toEqual(['src/A.ts']);
    expect(run.output).toContain('not linting src/Portal/Public/app.js');
    expect(run.output).toContain('Portal ESLint: skipped (no staged portal JS files)');
  });

  it('fails the gate when ESLint fails', () => {
    writeRepoFile('src/A.ts');
    git('add', '-A');
    expect(runGate(1).status).toBe(1);
  });
});
