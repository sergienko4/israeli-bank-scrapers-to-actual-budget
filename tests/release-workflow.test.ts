/**
 * Runs and reads the release workflow as written.
 *
 * Each architecture builds on its own native runner and pushes an untagged
 * candidate; the image is tagged only after both candidates passed their
 * smoke test. A rehearsal runs the same legs but must never reach Docker Hub
 * or the release secrets. The behavioural cases lift a step's `run:` script
 * and run it the way Actions runs a bash step, with `docker` replaced by a
 * fake that logs its calls; the structural cases pin the job graph that the
 * scripts cannot see.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RELEASE = '.github/workflows/release.yml';
const GHCR_IMAGE = 'ghcr.io/sergienko4/israeli-bank-importer';
const SHA = 'b'.repeat(40);
const AMD64_DIGEST = 'a'.repeat(64);
const ARM64_DIGEST = 'c'.repeat(64);
const NOT_REHEARSAL = "needs.prepare.outputs.mode != 'rehearsal'";

/** bash runs every step; CI must have it, a laptop may lack it. */
const CAN_RUN = spawnSync('bash', ['--version']).status === 0 || process.env.CI === 'true';

const FAKE_DOCKER = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "\${FAKE_DIR}/docker-calls.log"
`;

/** Fields of a workflow step this suite reads. */
interface IStep {
  readonly id?: string;
  readonly if?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Readonly<Record<string, string | boolean>>;
}

/** Fields of a workflow job this suite reads. */
interface IJob {
  readonly needs?: string | readonly string[];
  readonly 'runs-on'?: string;
  readonly strategy?: {
    readonly 'fail-fast'?: boolean;
    readonly matrix?: { readonly include?: readonly Readonly<Record<string, string>>[] };
  };
  readonly steps: readonly IStep[];
}

/** What a step run left behind. */
interface IStepRun {
  readonly status: number | null;
  readonly outputs: Readonly<Record<string, string>>;
  readonly dockerCalls: readonly string[];
}

let bin = '';
let work = '';

beforeAll(() => {
  bin = mkdtempSync(join(tmpdir(), 'release-workflow-bin-'));
  writeFileSync(join(bin, 'docker'), FAKE_DOCKER);
  chmodSync(join(bin, 'docker'), 0o755);
});

afterAll(() => {
  rmSync(bin, { recursive: true, force: true });
});

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'release-workflow-'));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/**
 * Reads the jobs of the release workflow.
 * @returns The workflow's jobs by id.
 */
function jobs(): Readonly<Record<string, IJob>> {
  const workflow = parse(readFileSync(join(ROOT, RELEASE), 'utf8')) as { jobs: Record<string, IJob> };
  return workflow.jobs;
}

/**
 * Finds a step by its id; a missing id fails the calling test.
 * @param jobId - Job that owns the step.
 * @param stepId - Step id.
 * @returns The step.
 */
function step(jobId: string, stepId: string): IStep {
  const found = jobs()[jobId]?.steps.find((candidate) => candidate.id === stepId);
  if (found === undefined) throw new Error(`release.yml ${jobId} has no step with id ${stepId}`);
  return found;
}

/**
 * Lists the ids of a job's steps in order.
 * @param jobId - Job id.
 * @returns Step ids, with an empty string for a step without one.
 */
function stepIds(jobId: string): string[] {
  return (jobs()[jobId]?.steps ?? []).map((candidate) => candidate.id ?? '');
}

/**
 * Splits a step condition into its `&&` terms.
 * @param condition - The step's `if:` expression.
 * @returns The trimmed terms; empty when the condition uses `||`.
 */
function conjuncts(condition: string | undefined): string[] {
  if (condition === undefined || condition.includes('||')) return [];
  return condition.split('&&').map((term) => term.trim());
}

/**
 * Parses a GITHUB_OUTPUT file of `name=value` lines.
 * @param text - File contents.
 * @returns The outputs by name.
 */
function parseOutputs(text: string): Record<string, string> {
  const pairs = text
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]);
  return Object.fromEntries(pairs) as Record<string, string>;
}

/**
 * Runs a step's script the way Actions runs a bash step.
 * @param target - The step to run.
 * @param env - Environment the step sees.
 * @param cwd - Working directory; the scratch folder when omitted.
 * @returns Exit status, outputs and the fake docker calls.
 */
function runStep(target: IStep, env: Readonly<Record<string, string>>, cwd = work): IStepRun {
  const outputFile = join(work, 'github-output');
  writeFileSync(outputFile, '');
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', target.run ?? 'exit 99'], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      FAKE_DIR: work,
      GITHUB_OUTPUT: outputFile,
      RUNNER_TEMP: work,
      GHCR_IMAGE,
      ...env,
    },
    timeout: 20_000,
  });
  const callLog = join(work, 'docker-calls.log');
  return {
    status: result.status,
    outputs: parseOutputs(readFileSync(outputFile, 'utf8')),
    dockerCalls: existsSync(callLog) ? readFileSync(callLog, 'utf8').trim().split('\n') : [],
  };
}

/**
 * Runs the release-mode step for one trigger.
 * @param env - Event name, tag and rehearsal inputs.
 * @returns The step run.
 */
function resolveMode(env: Readonly<Record<string, string>>): IStepRun {
  return runStep(step('prepare', 'mode'), {
    GITHUB_SHA: SHA,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REF_NAME: 'main',
    INPUT_TAG: '',
    INPUT_REHEARSAL: '',
    ...env,
  });
}

/**
 * Stages digest files the way the download step leaves them.
 * @param names - File names to create in the digests folder.
 * @returns The digests folder.
 */
function stageDigests(names: readonly string[]): string {
  const dir = join(work, 'digests');
  mkdirSync(dir, { recursive: true });
  for (const name of names) writeFileSync(join(dir, name), '');
  return dir;
}

describe.runIf(CAN_RUN)('release workflow scripts', () => {
  it('publishes a pushed tag as itself, without the tooling overlay', () => {
    const run = resolveMode({ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/v1.44.0', GITHUB_REF_NAME: 'v1.44.0' });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({ mode: 'tag-push', version: 'v1.44.0', ref: 'refs/tags/v1.44.0', overlay: 'false' });
  });

  it('republishes a dispatched tag from that tag with the tooling overlay', () => {
    const run = resolveMode({ GITHUB_EVENT_NAME: 'workflow_dispatch', INPUT_TAG: 'v1.43.8', INPUT_REHEARSAL: 'false' });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({ mode: 'republish', version: 'v1.43.8', ref: 'v1.43.8', overlay: 'true' });
  });

  it.each(['', 'v1.43', 'v1.43.8; id', '1.43.8'])('rejects the dispatched tag %j', (tag) => {
    const run = resolveMode({ GITHUB_EVENT_NAME: 'workflow_dispatch', INPUT_TAG: tag, INPUT_REHEARSAL: 'false' });

    expect(run.status).toBe(1);
    expect(run.outputs).toEqual({});
  });

  it('rehearses the dispatched commit under the rehearsal version, ignoring any tag', () => {
    const run = resolveMode({ GITHUB_EVENT_NAME: 'workflow_dispatch', INPUT_TAG: 'v1.43.8', INPUT_REHEARSAL: 'true' });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({ mode: 'rehearsal', version: 'rehearsal', ref: SHA, overlay: 'false' });
  });

  it.each([
    { files: ['tests/e2e/image-contents.e2e.test.ts', 'config/vitest.config.e2e.ts'], mode: 'modern' },
    { files: ['tests/e2e/image-contents.e2e.test.ts'], mode: 'legacy' },
    { files: [], mode: 'legacy' },
  ])('picks the $mode smoke test for a tag with $files.length of its files', ({ files, mode }) => {
    for (const file of files) {
      mkdirSync(join(work, file, '..'), { recursive: true });
      writeFileSync(join(work, file), '');
    }

    expect(runStep(step('build', 'smoke_mode'), {}).outputs).toEqual({ mode });
  });

  it.each([
    { label: 'no digest', digest: '' },
    { label: 'a short digest', digest: 'sha256:abc' },
    { label: 'a digest without its algorithm', digest: AMD64_DIGEST },
  ])('refuses to smoke test $label', ({ digest }) => {
    const run = runStep(step('build', 'candidate'), { DIGEST: digest });

    expect(run.status).toBe(1);
    expect(run.dockerCalls).toEqual([]);
  });

  it('smoke tests exactly the pushed digest under the E2E image name', () => {
    const run = runStep(step('build', 'candidate'), { DIGEST: `sha256:${AMD64_DIGEST}` });

    expect(run.status).toBe(0);
    expect(run.dockerCalls).toEqual([
      `pull ${GHCR_IMAGE}@sha256:${AMD64_DIGEST}`,
      `tag ${GHCR_IMAGE}@sha256:${AMD64_DIGEST} israeli-bank-importer:e2e`,
      'image inspect israeli-bank-importer:e2e',
    ]);
  });

  it.each([
    { label: 'one digest', names: [AMD64_DIGEST] },
    { label: 'a stray file beside both digests', names: [AMD64_DIGEST, ARM64_DIGEST, 'notes.txt'] },
    { label: 'two files that are not digests', names: ['amd64', 'arm64'] },
  ])('refuses to publish with $label', ({ names }) => {
    stageDigests(names);

    expect(runStep(step('publish', 'digest_count'), {}).status).toBe(1);
  });

  it('accepts exactly the two platform digests', () => {
    stageDigests([AMD64_DIGEST, ARM64_DIGEST]);

    expect(runStep(step('publish', 'digest_count'), {}).status).toBe(0);
  });

  it('tags one index from both digests with every metadata tag', () => {
    const dir = stageDigests([AMD64_DIGEST, ARM64_DIGEST]);

    const run = runStep(step('publish', 'index'), { TAGS: `${GHCR_IMAGE}:v1.44.0\n`, VERSION: 'v1.44.0' }, dir);

    expect(run.status).toBe(0);
    expect(run.dockerCalls).toEqual([
      `buildx imagetools create -t ${GHCR_IMAGE}:v1.44.0 ${GHCR_IMAGE}@sha256:${AMD64_DIGEST} ${GHCR_IMAGE}@sha256:${ARM64_DIGEST}`,
      `buildx imagetools inspect ${GHCR_IMAGE}:v1.44.0`,
    ]);
  });

  it('writes no index when metadata produced no tag', () => {
    const dir = stageDigests([AMD64_DIGEST, ARM64_DIGEST]);

    const run = runStep(step('publish', 'index'), { TAGS: '\n', VERSION: 'v1.44.0' }, dir);

    expect(run.status).toBe(1);
    expect(run.dockerCalls).toEqual([]);
  });
});

describe('release workflow job graph', () => {
  it.each([
    'login_dockerhub',
    'install_regctl',
    'push_dockerhub',
    'dockerhub_warning',
    'sbom',
    'notes',
    'gh_release',
    'dockerhub_description',
  ])('skips publish step %s in a rehearsal', (id) => {
    expect(conjuncts(step('publish', id).if)).toContain(NOT_REHEARSAL);
  });

  it('gives a rehearsal no step that reads a secret besides the GHCR token', () => {
    const readers = Object.values(jobs())
      .flatMap((job) => job.steps)
      .filter((candidate) => /secrets\.(?!GITHUB_TOKEN\b)/.test(JSON.stringify(candidate)));

    expect(readers.length).toBeGreaterThan(0);
    for (const reader of readers) expect(conjuncts(reader.if), reader.id).toContain(NOT_REHEARSAL);
  });

  it('skips the manifest checks in a rehearsal, which has no tag', () => {
    expect(stepIds('prepare')).toEqual(['mode', 'checkout', 'manifest', 'changelog']);
    for (const id of stepIds('prepare').slice(1)) {
      expect(conjuncts(step('prepare', id).if), id).toContain("steps.mode.outputs.mode != 'rehearsal'");
    }
  });

  it('publishes only after both builds, and builds only after prepare', () => {
    expect(jobs().publish?.needs).toEqual(['prepare', 'build']);
    expect(jobs().build?.needs).toBe('prepare');
  });

  it('builds each architecture once on its native runner and stops both on a failure', () => {
    const build = jobs().build;

    expect(build?.['runs-on']).toBe('${{ matrix.runner }}');
    expect(build?.strategy?.matrix?.include).toEqual([
      { arch: 'amd64', runner: 'ubuntu-24.04' },
      { arch: 'arm64', runner: 'ubuntu-24.04-arm' },
    ]);
    expect(build?.strategy?.['fail-fast']).toBe(true);
  });

  it('emulates no architecture and builds one platform per leg', () => {
    const allSteps = Object.values(jobs()).flatMap((job) => job.steps);

    expect(allSteps.filter((candidate) => candidate.uses?.includes('setup-qemu-action'))).toEqual([]);
    expect(step('build', 'build').with?.platforms).toBe('linux/${{ matrix.arch }}');
  });

  it('pushes the candidate by digest so the build writes no tag', () => {
    expect(step('build', 'build').with).toMatchObject({ 'push-by-digest': 'true', load: 'false' });
    expect(step('build', 'build').with).not.toHaveProperty('push');
  });

  it('picks the smoke test before installing for it, and installs only for the modern one', () => {
    const ids = stepIds('build');

    expect(ids.indexOf('smoke_mode')).toBeGreaterThan(ids.indexOf('candidate'));
    expect(ids.indexOf('smoke_mode')).toBeLessThan(ids.indexOf('setup'));
    expect(step('build', 'setup').uses).toBe('./.github/actions/ci/setup');
    expect(step('build', 'setup').if).toBe("steps.smoke_mode.outputs.mode == 'modern'");
    expect(step('build', 'smoke').if).toBe("steps.smoke_mode.outputs.mode == 'modern'");
    expect(step('build', 'smoke_legacy').if).toBe("steps.smoke_mode.outputs.mode == 'legacy'");
  });

  it('hands publish a digest only after its smoke test passed', () => {
    const ids = stepIds('build');

    for (const id of ['digest', 'upload_digest']) {
      expect(ids.indexOf(id), id).toBeGreaterThan(ids.indexOf('smoke'));
      expect(ids.indexOf(id), id).toBeGreaterThan(ids.indexOf('smoke_legacy'));
      expect(step('build', id).if, id).toBeUndefined();
    }
  });

  it('logs in and tags GHCR before the Docker Hub mirror, from full history', () => {
    const ids = stepIds('publish');

    expect(step('publish', 'checkout').with?.['fetch-depth']).toBe(0);
    expect(ids.indexOf('checkout')).toBeLessThan(ids.indexOf('login_ghcr'));
    expect(ids.indexOf('login_ghcr')).toBeLessThan(ids.indexOf('index'));
    expect(ids.indexOf('index')).toBeLessThan(ids.indexOf('push_dockerhub'));
    expect(ids.indexOf('login_dockerhub')).toBeLessThan(ids.indexOf('push_dockerhub'));
    expect(ids.indexOf('checkout')).toBeLessThan(ids.indexOf('dockerhub_description'));
  });

  it('tags the index with the prepared version only', () => {
    expect(step('publish', 'meta_ghcr').with?.tags).toBe('${{ needs.prepare.outputs.version }}');
    expect(step('publish', 'index').run).toContain('imagetools create');
    expect(
      Object.values(jobs())
        .flatMap((job) => job.steps)
        .filter((candidate) => candidate.run?.includes('imagetools create')),
    ).toHaveLength(1);
  });
});
