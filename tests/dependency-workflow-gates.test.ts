/**
 * Runs the fail-closed gates of the dependency workflows as written.
 *
 * Each case lifts one step's `run:` script out of its workflow and runs it
 * the way Actions runs a bash step, with `gh`, `git` and `node` replaced by
 * fakes that answer from fixtures. The assertions read the step's outputs
 * and exit status, so a rewrite of the shell must still fail closed in the
 * same cases: a refresh summary without a major count, a refresh branch with
 * no proven push lock, a Dependabot pull request carrying more than one
 * Dependabot commit, a CI verdict read from anything but the newest CI run
 * for the head, and a run that cannot name its pull request.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REFRESH = '.github/workflows/lockfile-refresh.yml';
const AUTOMERGE = '.github/workflows/dependabot-auto-merge.yml';
const REPO = 'sergienko4/israeli-bank-scrapers-to-actual-budget';
const TITLE = 'fix(deps): refresh package-lock.json';
const BODY = 'Refreshed 3 transitive pins: katex 0.18.9 -> 0.18.10.';
const HEAD_SHA = 'a'.repeat(40);
const BRANCH = 'chore/lockfile-refresh-1';
const DEPENDABOT_EMAIL = '49699333+dependabot[bot]@users.noreply.github.com';

/** bash and jq run every step; CI must have both, a laptop may lack them. */
const HAS_TOOLS = ['bash', 'jq'].every((tool) => spawnSync(tool, ['--version']).status === 0);
const CAN_RUN = HAS_TOOLS || process.env.CI === 'true';

/**
 * Logs every call; `gh api` answers GETs from a fixture named after the
 * path (an absent fixture is an API error), `gh pr view` prints the pull
 * request number, and every other command succeeds silently.
 */
const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "\${FAKE_DIR}/gh-calls.log"
case "$1" in
  api) ;;
  pr) [ "$2" != view ] || echo "\${FAKE_PR_NUMBER}"; exit 0 ;;
  *) exit 0 ;;
esac
shift
path='' jq_filter='' method=GET
while [ "$#" -gt 0 ]; do
  case "$1" in
    --jq) jq_filter="$2"; shift 2 ;;
    -X) method="$2"; shift 2 ;;
    -H | -f | -F) shift 2 ;;
    -*) shift ;;
    *) path="$1"; shift ;;
  esac
done
[ "\${method}" = GET ] || { echo '{}'; exit 0; }
fixture="\${FAKE_DIR}/gh/$(printf '%s' "\${path}" | tr -c 'A-Za-z0-9._-' '_')"
[ -f "\${fixture}" ] || { echo "fake gh: no fixture for \${path}" >&2; exit 1; }
if [ -n "\${jq_filter}" ]; then jq -r "\${jq_filter}" "\${fixture}"; else cat "\${fixture}"; fi
`;

const FAKE_GIT = `#!/usr/bin/env bash
[ "$1" != rev-parse ] || echo "\${FAKE_HEAD_SHA}"
`;

const FAKE_NODE = `#!/usr/bin/env bash
cat "\${FAKE_DIR}/node-output"
`;

/** Fields of a workflow step this suite reads. */
interface IStep {
  readonly id?: string;
  readonly if?: string;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/** Fields of a workflow job this suite reads. */
interface IJob {
  readonly needs?: string;
  readonly if?: string;
  readonly concurrency?: { readonly group?: string };
  readonly steps: readonly IStep[];
}

/** Fake answers for one step run. */
interface IRunOptions {
  readonly env: Readonly<Record<string, string>>;
  readonly gh?: Readonly<Record<string, unknown>>;
  readonly nodeOutput?: unknown;
}

/** What a step run left behind. */
interface IStepRun {
  readonly status: number | null;
  readonly outputs: Readonly<Record<string, string>>;
  readonly ghCalls: readonly string[];
  readonly temp: string;
}

let bin = '';
let work = '';

beforeAll(() => {
  bin = mkdtempSync(join(tmpdir(), 'workflow-gates-bin-'));
  writeExecutable(join(bin, 'gh'), FAKE_GH);
  writeExecutable(join(bin, 'git'), FAKE_GIT);
  writeExecutable(join(bin, 'node'), FAKE_NODE);
});

afterAll(() => {
  rmSync(bin, { recursive: true, force: true });
});

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'workflow-gates-'));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/**
 * Reads the jobs of a workflow.
 * @param file - Repository-relative workflow path.
 * @returns The workflow's jobs by id.
 */
function jobsOf(file: string): Readonly<Record<string, IJob>> {
  const workflow = parse(readFileSync(join(ROOT, file), 'utf8')) as { jobs: Record<string, IJob> };
  return workflow.jobs;
}

/**
 * Finds a step by id.
 * @param file - Repository-relative workflow path.
 * @param job - Job id.
 * @param id - Step id.
 * @returns The step.
 */
function stepOf(file: string, job: string, id: string): IStep {
  const step = jobsOf(file)[job]?.steps.find((candidate) => candidate.id === id);
  if (step === undefined) throw new Error(`${file}: no step ${job}.${id}`);
  return step;
}

/**
 * Maps a `gh api` path to its fixture file name, as the fake does.
 * @param path - API path.
 * @returns The fixture file name.
 */
function fixtureName(path: string): string {
  return path.replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Writes an executable file.
 * @param path - Destination.
 * @param text - Contents.
 */
function writeExecutable(path: string, text: string): void {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

/**
 * Writes the fixtures the fakes answer from for one run.
 * @param options - Fixtures to serve.
 */
function stageFixtures(options: IRunOptions): void {
  mkdirSync(join(work, 'gh'), { recursive: true });
  for (const [path, value] of Object.entries(options.gh ?? {})) {
    writeFileSync(join(work, 'gh', fixtureName(path)), JSON.stringify(value));
  }
  writeFileSync(join(work, 'node-output'), JSON.stringify(options.nodeOutput ?? null));
}

/**
 * Parses a GITHUB_OUTPUT file, including `name<<DELIMITER` blocks.
 * @param text - File contents.
 * @returns The outputs by name.
 */
function parseOutputs(text: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const block = /^([^=<]+)<<(.+)$/.exec(line);
    if (block?.[1] !== undefined && block[2] !== undefined) {
      const end = lines.indexOf(block[2], index + 1);
      outputs[block[1]] = lines.slice(index + 1, end).join('\n');
      index = end;
    } else if (line.includes('=')) {
      outputs[line.slice(0, line.indexOf('='))] = line.slice(line.indexOf('=') + 1);
    }
  }
  return outputs;
}

/**
 * Runs a step script the way Actions runs a `shell: bash` step.
 * @param step - The workflow step.
 * @param options - Step environment and fake answers.
 * @returns Exit status, outputs and the `gh` calls made.
 */
function runStep(step: IStep, options: IRunOptions): IStepRun {
  stageFixtures(options);
  const temp = join(work, 'runner-temp');
  mkdirSync(temp, { recursive: true });
  const outputFile = join(work, 'github-output');
  writeFileSync(outputFile, '');
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step.run ?? 'exit 99'], {
    cwd: work,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      FAKE_DIR: work,
      FAKE_PR_NUMBER: '42',
      FAKE_HEAD_SHA: HEAD_SHA,
      GITHUB_REPOSITORY: REPO,
      GITHUB_RUN_ID: '1',
      GITHUB_OUTPUT: outputFile,
      RUNNER_TEMP: temp,
      ...options.env,
    },
    timeout: 20_000,
  });
  const callLog = join(work, 'gh-calls.log');
  return {
    status: result.status,
    outputs: parseOutputs(readFileSync(outputFile, 'utf8')),
    ghCalls: existsSync(callLog) ? readFileSync(callLog, 'utf8').trim().split('\n') : [],
    temp,
  };
}

/**
 * Builds a ruleset as GET /repos/{owner}/{repo}/rulesets/{id} returns it.
 * @param overrides - Fields to replace.
 * @returns The ruleset.
 */
function ruleset(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { enforcement: 'active', bypass_actors: [], rules: [{ type: 'update' }], ...overrides };
}

/**
 * Builds a Dependabot commit as the pull-request commits API returns it.
 * @param sha - Commit SHA.
 * @param message - Commit message.
 * @returns The commit.
 */
function dependabotCommit(sha: string, message: string): Record<string, unknown> {
  return {
    sha,
    author: { login: 'dependabot[bot]' },
    committer: { login: 'web-flow' },
    parents: [{ sha: 'b'.repeat(40) }],
    commit: {
      message,
      author: { email: DEPENDABOT_EMAIL },
      verification: { verified: true, reason: 'valid' },
    },
  };
}

describe.skipIf(!CAN_RUN)('lockfile refresh summary', () => {
  const step = stepOf(REFRESH, 'refresh', 'summary');

  it('publishes the major count of a complete summary', () => {
    const majorBumps = [{ name: 'typescript' }, { name: 'vitest' }];
    const nodeOutput = { title: TITLE, body: BODY, majorBumps };

    const run = runStep(step, { env: {}, nodeOutput });

    expect(run.status).toBe(0);
    expect(run.outputs).toMatchObject({ title: TITLE, majors: '2', body: BODY });
  });

  it.each([
    ['majorBumps is missing', { title: TITLE, body: BODY }],
    ['majorBumps is null', { title: TITLE, body: BODY, majorBumps: null }],
    ['majorBumps is an object', { title: TITLE, body: BODY, majorBumps: { typescript: '7.0.0' } }],
    ['the title is missing', { body: BODY, majorBumps: [] }],
    ['the body is empty', { title: TITLE, body: '', majorBumps: [] }],
  ])('fails before publishing anything when %s', (_case, nodeOutput) => {
    const run = runStep(step, { env: {}, nodeOutput });

    expect(run.status).not.toBe(0);
    expect(run.outputs).toEqual({});
  });
});

describe.skipIf(!CAN_RUN)('lockfile refresh push lock', () => {
  const step = stepOf(REFRESH, 'refresh', 'lock');
  const rulesPath = `repos/${REPO}/rules/branches/${BRANCH}`;
  const env = { BRANCH, GH_TOKEN: 'token' };

  it('is proven by an active update rule nobody may bypass', () => {
    const gh = { [rulesPath]: [{ type: 'update', ruleset_id: 7 }], [`repos/${REPO}/rulesets/7`]: ruleset() };

    const run = runStep(step, { env, gh });

    expect(run.status).toBe(0);
    expect(run.outputs.locked).toBe('true');
  });

  it('needs only one strict ruleset when several restrict updates', () => {
    const gh = {
      [rulesPath]: [
        { type: 'update', ruleset_id: 7 },
        { type: 'update', ruleset_id: 8 },
      ],
      [`repos/${REPO}/rulesets/7`]: ruleset({ bypass_actors: [{ actor_type: 'RepositoryRole' }] }),
      [`repos/${REPO}/rulesets/8`]: ruleset(),
    };

    expect(runStep(step, { env, gh }).outputs.locked).toBe('true');
  });

  it.each([
    ['the rules cannot be read', {}],
    ['no rule applies', { [rulesPath]: [] }],
    ['only other rules apply', { [rulesPath]: [{ type: 'deletion', ruleset_id: 7 }] }],
    [
      'the ruleset has a bypass actor',
      {
        [rulesPath]: [{ type: 'update', ruleset_id: 7 }],
        [`repos/${REPO}/rulesets/7`]: ruleset({ bypass_actors: [{ actor_type: 'RepositoryRole' }] }),
      },
    ],
    [
      'the token cannot see the bypass list',
      {
        [rulesPath]: [{ type: 'update', ruleset_id: 7 }],
        [`repos/${REPO}/rulesets/7`]: { enforcement: 'active', rules: [{ type: 'update' }] },
      },
    ],
    [
      'the ruleset only evaluates',
      {
        [rulesPath]: [{ type: 'update', ruleset_id: 7 }],
        [`repos/${REPO}/rulesets/7`]: ruleset({ enforcement: 'evaluate' }),
      },
    ],
    ['the ruleset cannot be read', { [rulesPath]: [{ type: 'update', ruleset_id: 7 }] }],
  ])('is not proven when %s', (_case, gh) => {
    const run = runStep(step, { env, gh });

    expect(run.status).toBe(0);
    expect(run.outputs.locked).toBe('false');
    expect(run.outputs.why).not.toBe('');
  });
});

describe.skipIf(!CAN_RUN)('lockfile refresh arming', () => {
  const step = stepOf(REFRESH, 'refresh', 'pr');
  const env = { BRANCH, GH_TOKEN: 'token', TITLE, BODY, MAJORS: '0', LOCK_WHY: '' };
  const armed = (calls: readonly string[]): boolean => calls.some((call) => call.startsWith('pr merge'));
  const labelled = (calls: readonly string[]): boolean =>
    calls.some((call) => call.includes(`repos/${REPO}/issues/42/labels`));

  it('arms the exact head when the branch is proven push-locked', () => {
    const run = runStep(step, { env: { ...env, LOCKED: 'true' } });

    expect(run.status).toBe(0);
    expect(run.ghCalls).toContain(`pr merge ${BRANCH} --repo ${REPO} --auto --squash --match-head-commit ${HEAD_SHA}`);
  });

  it.each([
    ['not proven', 'false'],
    ['unreported', ''],
  ])('labels and fails without arming when the lock is %s', (_case, locked) => {
    const run = runStep(step, { env: { ...env, LOCKED: locked } });

    expect(run.status).toBe(1);
    expect(labelled(run.ghCalls)).toBe(true);
    expect(armed(run.ghCalls)).toBe(false);
  });

  it.each([
    ['proven', 'true'],
    ['not proven', 'false'],
    ['unreported', ''],
  ])('labels a refresh that crosses a major without arming when the lock is %s', (_case, locked) => {
    const run = runStep(step, { env: { ...env, MAJORS: '2', LOCKED: locked } });

    expect(run.status).toBe(0);
    expect(labelled(run.ghCalls)).toBe(true);
    expect(armed(run.ghCalls)).toBe(false);
  });
});

describe.skipIf(!CAN_RUN)('Dependabot auto-merge pull-request lookup', () => {
  const step = stepOf(AUTOMERGE, 'pr', 'find');
  const pullsPath = `repos/${REPO}/commits/${HEAD_SHA}/pulls`;

  it.each([
    ['a dispatched number', { DISPATCH_PR: '17', RUN_HEAD_SHA: '' }, {}, '17'],
    [
      'the open pull request of the tested head',
      { DISPATCH_PR: '', RUN_HEAD_SHA: HEAD_SHA },
      {
        [pullsPath]: [
          { state: 'closed', number: 3 },
          { state: 'open', number: 9 },
        ],
      },
      '9',
    ],
  ])('publishes %s', (_case, env, gh, number) => {
    const run = runStep(step, { env: { ...env, GH_TOKEN: 'token' }, gh });

    expect(run.status).toBe(0);
    expect(run.outputs.number).toBe(number);
  });

  it.each([
    ['the dispatch input is not a number', { DISPATCH_PR: '17/../x', RUN_HEAD_SHA: '' }, {}],
    ['the dispatch input has a leading zero', { DISPATCH_PR: '0786', RUN_HEAD_SHA: '' }, {}],
    ['the dispatch input is zero', { DISPATCH_PR: '0', RUN_HEAD_SHA: '' }, {}],
    ['the tested head has no open pull request', { DISPATCH_PR: '', RUN_HEAD_SHA: HEAD_SHA }, { [pullsPath]: [] }],
  ])('publishes nothing when %s', (_case, env, gh) => {
    const run = runStep(step, { env: { ...env, GH_TOKEN: 'token' }, gh });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({});
  });

  it('fails without publishing when the lookup errors', () => {
    const run = runStep(step, { env: { DISPATCH_PR: '', RUN_HEAD_SHA: HEAD_SHA, GH_TOKEN: 'token' } });

    expect(run.status).not.toBe(0);
    expect(run.outputs).toEqual({});
  });

  it('keys the decision lock on the pull request the decision reads', () => {
    const automerge = jobsOf(AUTOMERGE).automerge;
    const resolve = stepOf(AUTOMERGE, 'automerge', 'resolve');

    expect(automerge?.needs).toBe('pr');
    expect(automerge?.concurrency?.group).toBe('dependabot-auto-merge-${{ needs.pr.outputs.number }}');
    expect(resolve.env?.CANDIDATE_PR).toBe('${{ needs.pr.outputs.number }}');
  });
});

describe.skipIf(!CAN_RUN)('Dependabot auto-merge resolve', () => {
  const step = stepOf(AUTOMERGE, 'automerge', 'resolve');
  const message = 'Bump katex from 0.18.9 to 0.18.10\n\n---\nupdated-dependencies:\n- dependency-name: katex\n';
  const ciWorkflow = step.env?.CI_WORKFLOW ?? '';
  const env = { CANDIDATE_PR: '5', RUN_HEAD_SHA: HEAD_SHA, GH_TOKEN: 'token', READ_TOKEN: 'read', CI_WORKFLOW: ciWorkflow };
  const runsPath = `repos/${REPO}/actions/workflows/${ciWorkflow}/runs?head_sha=${HEAD_SHA}&event=pull_request&per_page=100`;
  const passed = ciRun(300, '2026-05-04T08:15:00Z', 'success');

  /**
   * Builds a PR Pipeline run as the workflow-runs API lists it.
   * @param id - Run id.
   * @param started - Start of the run's latest attempt.
   * @param conclusion - Conclusion, or `null` while the run is in progress.
   * @returns The run.
   */
  function ciRun(id: number, started: string, conclusion: string | null): Record<string, unknown> {
    return { id, run_started_at: started, status: conclusion === null ? 'in_progress' : 'completed', conclusion };
  }

  /**
   * Builds the run list as `gh api --paginate --slurp` prints it: one entry
   * per page, each carrying the total GitHub reports.
   * @param pages - The runs on each page.
   * @param total - The total count GitHub reports; defaults to every run.
   * @returns The pages.
   */
  function listing(pages: readonly (readonly Record<string, unknown>[])[], total = pages.flat().length): unknown[] {
    return pages.map((runs) => ({ total_count: total, workflow_runs: runs }));
  }

  /**
   * Fixtures for an open Dependabot pull request.
   * @param commits - The pull request's commits, oldest first.
   * @param runs - PR Pipeline run pages for its head, or `null` for an API error.
   * @returns The `gh api` fixtures.
   */
  function pullRequest(
    commits: readonly Record<string, unknown>[],
    runs: readonly unknown[] | null = listing([[passed]]),
  ): Record<string, unknown> {
    return {
      [`repos/${REPO}/pulls/5`]: {
        state: 'open',
        user: { login: 'dependabot[bot]' },
        head: { repo: { full_name: REPO }, sha: HEAD_SHA, ref: 'dependabot/npm_and_yarn/katex-0.18.10' },
      },
      [`repos/${REPO}/pulls/5/commits?per_page=100`]: commits,
      user: { login: 'owner' },
      [`repos/${REPO}/issues/5/comments`]: [],
      ...(runs === null ? {} : { [runsPath]: runs }),
    };
  }

  it('reads the metadata of a single Dependabot commit', () => {
    const run = runStep(step, { env, gh: pullRequest([dependabotCommit(HEAD_SHA, message)]) });

    expect(run.status).toBe(0);
    expect(run.outputs).toMatchObject({ number: '5', skip: 'false', disarm: 'false', ecosystem: 'npm_and_yarn' });
    expect(readFileSync(join(run.temp, 'message.txt'), 'utf8').trimEnd()).toBe(message.trimEnd());
  });

  it('distrusts a pull request with a second Dependabot commit', () => {
    const second = dependabotCommit(HEAD_SHA, 'Bump typescript from 6.0.3 to 7.0.0\n\n---\nupdated-dependencies:\n- dependency-name: typescript\n');
    const commits = [dependabotCommit('c'.repeat(40), message), second];

    const run = runStep(step, { env, gh: pullRequest(commits) });

    expect(run.status).toBe(0);
    expect(run.outputs).toMatchObject({ number: '5', skip: 'true', disarm: 'true' });
  });

  it.each([
    [
      'the newest run passed',
      [ciRun(299, '2026-05-04T08:01:00Z', 'failure'), passed],
      'success',
    ],
    [
      'the newest run failed after a pass',
      [ciRun(299, '2026-05-04T08:01:00Z', 'success'), ciRun(300, '2026-05-04T08:15:00Z', 'failure')],
      'failure',
    ],
    [
      'an older run was re-run last',
      [ciRun(299, '2026-05-04T08:40:00Z', 'success'), ciRun(300, '2026-05-04T08:15:00Z', 'failure')],
      'success',
    ],
    [
      'two runs started the same second',
      [ciRun(301, '2026-05-04T08:15:00Z', 'failure'), ciRun(300, '2026-05-04T08:15:00Z', 'success')],
      'failure',
    ],
    ['the newest run is in progress', [passed, ciRun(301, '2026-05-04T08:30:00Z', null)], 'pending'],
    ['no run exists yet', [], 'pending'],
  ])('publishes the CI verdict when %s', (_case, runs, verdict) => {
    const run = runStep(step, { env, gh: pullRequest([dependabotCommit(HEAD_SHA, message)], listing([runs])) });

    expect(run.status).toBe(0);
    expect(run.outputs).toMatchObject({ number: '5', skip: 'false', disarm: 'false', ci: verdict });
  });

  it('finds a re-run listed on a later page', () => {
    const pages = listing([[ciRun(300, '2026-05-04T08:15:00Z', 'failure')], [ciRun(299, '2026-05-04T08:40:00Z', 'success')]]);

    const run = runStep(step, { env, gh: pullRequest([dependabotCommit(HEAD_SHA, message)], pages) });

    expect(run.status).toBe(0);
    expect(run.outputs).toMatchObject({ number: '5', ci: 'success' });
  });

  it('fails after publishing the number when GitHub lists fewer runs than it counts', () => {
    const run = runStep(step, { env, gh: pullRequest([dependabotCommit(HEAD_SHA, message)], listing([[passed]], 1001)) });

    expect(run.status).not.toBe(0);
    expect(run.outputs).toEqual({ number: '5' });
  });

  it('fails after publishing the number when the CI runs cannot be listed', () => {
    const run = runStep(step, { env, gh: pullRequest([dependabotCommit(HEAD_SHA, message)], null) });

    expect(run.status).not.toBe(0);
    expect(run.outputs).toEqual({ number: '5' });
  });

  it('reads the verdict of the workflow that triggers it', () => {
    const triggers = parse(readFileSync(join(ROOT, AUTOMERGE), 'utf8')) as { on: { workflow_run: { workflows: string[] } } };
    const ci = parse(readFileSync(join(ROOT, '.github/workflows', ciWorkflow), 'utf8')) as { name: string };

    expect(triggers.on.workflow_run.workflows).toEqual([ci.name]);
  });

  it('decides on the verdict it read, never on the one its trigger carried', () => {
    const automerge = JSON.stringify(jobsOf(AUTOMERGE).automerge);
    const decide = stepOf(AUTOMERGE, 'automerge', 'decide');

    expect(automerge).not.toContain('workflow_run.conclusion');
    expect(decide.if).toContain("steps.resolve.outputs.ci == 'success'");
  });
});
