/**
 * E2E tests for the Dependabot auto-merge decision step.
 *
 * Drives the real `scripts/check-dependabot-automerge.mjs` as a child process
 * the way `.github/workflows/dependabot-auto-merge.yml` runs it: flags →
 * message file → policy → `GITHUB_OUTPUT` + stdout + exit code. The unit suite
 * `tests/dependabot-automerge-logic.test.ts` covers the policy in isolation;
 * this suite proves the fail-closed contract at the process boundary. Every
 * failure path must exit non-zero, record `action=skip` where it can, and
 * never print a `merge` verdict.
 *
 * Each run gets its own `GITHUB_OUTPUT` file, so the suite never writes into
 * the runner's real step outputs when it executes inside GitHub Actions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../scripts/check-dependabot-automerge.mjs', import.meta.url));
const PATCH = 'version-update:semver-patch';
const MAJOR = 'version-update:semver-major';
const MERGE_JSON = '"action": "merge"';
const FAILED = 'decision step failed; failing closed';

/** Everything one CLI run produced. */
interface ICliRun {
  status: number | null;
  stdout: string;
  stderr: string;
  outputs: string;
}

let root: string;
let runCount = 0;

/**
 * Builds a Dependabot commit message holding one `updated-dependencies` entry.
 *
 * @param updateType The `update-type` recorded for the dependency.
 * @returns The full commit message, LF-separated.
 */
function message(updateType: string): string {
  return [
    'chore(deps): bump example from 1.2.2 to 1.2.3',
    '',
    '---',
    'updated-dependencies:',
    '- dependency-name: example',
    '  dependency-version: 1.2.3',
    '  dependency-type: direct:production',
    `  update-type: ${updateType}`,
    '...',
    '',
    'Signed-off-by: dependabot[bot] <support@github.com>',
  ].join('\n');
}

/**
 * Writes a commit message to a fresh file in the fixture directory.
 *
 * @param updateType The `update-type` recorded for the dependency.
 * @returns The path of the written message file.
 */
function writeMessage(updateType: string): string {
  const path = join(root, `message-${++runCount}.txt`);
  writeFileSync(path, message(updateType));
  return path;
}

/**
 * Reads the recorded step outputs, or nothing when the path is not a file.
 *
 * @param outputPath The `GITHUB_OUTPUT` path handed to the CLI.
 * @returns The file content, or an empty string.
 */
function readOutputs(outputPath: string): string {
  if (outputPath === '') return '';
  try {
    return statSync(outputPath).isFile() ? readFileSync(outputPath, 'utf8') : '';
  } catch {
    return '';
  }
}

/**
 * Runs the decision CLI with its own `GITHUB_OUTPUT` target.
 *
 * @param args The command-line flags.
 * @param outputPath The `GITHUB_OUTPUT` path; empty disables step outputs.
 * @returns The exit status, both streams and the recorded step outputs.
 */
function runCli(args: string[], outputPath = join(root, `output-${++runCount}.txt`)): ICliRun {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, GITHUB_OUTPUT: outputPath },
  });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, outputs: readOutputs(outputPath) };
}

/**
 * Builds the flags of a well-formed run for the given message file.
 *
 * @param messageFile The commit message file.
 * @param repinned The `--repinned` value.
 * @returns The flag list.
 */
function flags(messageFile: string, repinned = 'false'): string[] {
  return ['--message-file', messageFile, '--repinned', repinned, '--ecosystem', 'npm_and_yarn'];
}

/**
 * Asserts the fail-closed contract: exit 1, `skip` recorded, no `merge` printed.
 *
 * @param run The CLI run to check.
 */
function expectFailClosed(run: ICliRun): void {
  expect(run.status).toBe(1);
  expect(run.stdout).not.toContain(MERGE_JSON);
  expect(JSON.parse(run.stdout)).toMatchObject({ action: 'skip', reason: FAILED });
  expect(run.outputs).toBe(`action=skip\nreason=${FAILED}\n`);
  expect(run.stderr).toContain('Dependabot auto-merge decision failed');
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dependabot-automerge-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('check-dependabot-automerge CLI — verdicts', () => {
  it('records merge for a patch update and exits 0', () => {
    const run = runCli(flags(writeMessage(PATCH)));
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ action: 'merge' });
    expect(run.outputs).toBe('action=merge\nreason=every update is a patch, minor or digest refresh\n');
  });

  it('records label for a major update and exits 0', () => {
    const run = runCli(flags(writeMessage(MAJOR)));
    expect(run.status).toBe(0);
    expect(run.outputs).toBe('action=label\nreason=semver-major update: example\n');
  });

  it('records skip when allowScripts pins were rotated', () => {
    const run = runCli(flags(writeMessage(PATCH), 'true'));
    expect(run.status).toBe(0);
    expect(run.outputs).toBe('action=skip\nreason=allowScripts pins rotated; human review required\n');
  });

  it('records skip when --repinned is not a strict boolean', () => {
    const run = runCli(flags(writeMessage(PATCH), 'maybe'));
    expect(run.status).toBe(0);
    expect(run.outputs).toBe('action=skip\nreason=repinned state unknown; failing closed\n');
  });

  it('records skip when --ecosystem is missing', () => {
    const run = runCli(['--message-file', writeMessage(PATCH), '--repinned', 'false']);
    expect(run.status).toBe(0);
    expect(run.outputs).toBe('action=skip\nreason=unsupported ecosystem: (none)\n');
  });

  it('prints the verdict without step outputs when GITHUB_OUTPUT is unset', () => {
    const run = runCli(flags(writeMessage(PATCH)), '');
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ action: 'merge' });
  });
});

describe('check-dependabot-automerge CLI — failing closed', () => {
  it('fails closed when --message-file is missing', () => {
    expectFailClosed(runCli(['--repinned', 'false', '--ecosystem', 'npm_and_yarn']));
  });

  it('fails closed when --message-file has no value', () => {
    expectFailClosed(runCli(['--repinned', 'false', '--ecosystem', 'npm_and_yarn', '--message-file']));
  });

  it('fails closed when the message file cannot be read', () => {
    expectFailClosed(runCli(flags(join(root, 'missing-message.txt'))));
  });

  it('never prints merge when GITHUB_OUTPUT cannot be written', () => {
    const outputDir = join(root, `output-dir-${++runCount}`);
    mkdirSync(outputDir);
    const run = runCli(flags(writeMessage(PATCH)), outputDir);
    expect(run.status).toBe(1);
    expect(run.stdout).not.toContain(MERGE_JSON);
    expect(JSON.parse(run.stdout)).toMatchObject({ action: 'skip', reason: FAILED });
    expect(run.stderr).toContain('Unable to write step outputs');
  });
});
