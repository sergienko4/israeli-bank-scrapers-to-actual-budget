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
 * for the head, a run that cannot name its pull request, a decision lock
 * that lets a stale run cancel the current head's waiting run, a rebase
 * queue stalled by one pull request it cannot read, and a push to main that
 * regenerates a refresh main has not moved past, or one from a fork.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REFRESH = '.github/workflows/lockfile-refresh.yml';
const AUTOMERGE = '.github/workflows/dependabot-auto-merge.yml';
const SYNC = '.github/workflows/lockfile-sync.yml';
const PIN_NPM = '.github/actions/ci/pin-npm';
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
 * request number, `gh pr list` prints the staged pull request list,
 * `gh repo view` names `main` as the default branch, and every other
 * command succeeds silently. A fixture of
 * the form `{ "fakePages": [...] }` answers as a paged list does: the first
 * page alone, every page in turn with `--paginate`, and one array of pages
 * with `--paginate --slurp`, which gh refuses alone or with `--jq`.
 */
const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "\${FAKE_DIR}/gh-calls.log"
case "$1" in
  api) ;;
  pr)
    case "$2" in
      view) echo "\${FAKE_PR_NUMBER}" ;;
      list) [ ! -f "\${FAKE_DIR}/pr-list" ] || cat "\${FAKE_DIR}/pr-list" ;;
    esac
    exit 0 ;;
  repo) [ "$2" != view ] || echo main; exit 0 ;;
  *) exit 0 ;;
esac
shift
path='' jq_filter='' method=GET paginate=false slurp=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --jq) jq_filter="$2"; shift 2 ;;
    -X) method="$2"; shift 2 ;;
    -H | -f | -F) shift 2 ;;
    --paginate) paginate=true; shift ;;
    --slurp) slurp=true; shift ;;
    -*) shift ;;
    *) path="$1"; shift ;;
  esac
done
if [ "\${slurp}" = true ]; then
  [ "\${paginate}" = true ] || { echo 'fake gh: --paginate required when passing --slurp' >&2; exit 1; }
  [ -z "\${jq_filter}" ] || { echo 'fake gh: --slurp is not supported with --jq' >&2; exit 1; }
fi
[ "\${method}" = GET ] || { echo '{}'; exit 0; }
fixture="\${FAKE_DIR}/gh/$(printf '%s' "\${path}" | tr -c 'A-Za-z0-9._-' '_')"
[ -f "\${fixture}" ] || { echo "fake gh: no fixture for \${path}" >&2; exit 1; }
pages='.'
if jq -e 'type == "object" and has("fakePages")' "\${fixture}" > /dev/null; then
  if [ "\${paginate}" = true ]; then pages='.fakePages[]'; else pages='.fakePages[0]'; fi
fi
if [ "\${slurp}" = true ]; then jq -c "[\${pages}]" "\${fixture}"
elif [ -n "\${jq_filter}" ]; then jq -r "\${pages} | (\${jq_filter})" "\${fixture}"
else jq -c "\${pages}" "\${fixture}"
fi
`;

/**
 * Logs every call. `rev-parse HEAD:<file>` prints that file's blob from
 * FAKE_MANIFEST_BLOB or FAKE_LOCK_BLOB, any other `rev-parse` the head
 * commit. FAKE_GIT_DIFF lists the modified files, space-separated:
 * `diff --name-only` prints them, and `diff --quiet -- <paths>` fails when
 * any named path is among them.
 */
const FAKE_GIT = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "\${FAKE_DIR}/git-calls.log"
case "$1" in
  rev-parse)
    case "\${2:-}" in
      HEAD:package.json) echo "\${FAKE_MANIFEST_BLOB:-}" ;;
      HEAD:package-lock.json) echo "\${FAKE_LOCK_BLOB:-}" ;;
      *) echo "\${FAKE_HEAD_SHA}" ;;
    esac ;;
  diff)
    [ "\${2:-}" != --name-only ] || { printf '%s\\n' \${FAKE_GIT_DIFF:-}; exit 0; }
    for path in "$@"; do
      case " \${FAKE_GIT_DIFF:-} " in *" \${path} "*) exit 1 ;; esac
    done ;;
esac
exit 0
`;

/**
 * Logs every call and the directory it ran in, prints the staged output and
 * exits FAKE_NODE_STATUS.
 */
const FAKE_NODE = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "\${FAKE_DIR}/node-calls.log"
printf '%s\\n' "\${PWD}" >> "\${FAKE_DIR}/node-cwd.log"
cat "\${FAKE_DIR}/node-output"
exit "\${FAKE_NODE_STATUS:-0}"
`;

/**
 * Logs every call; `npm install -g npm@X` records X as installed, and
 * `npm --version` reports it unless FAKE_NPM_VERSION overrides the answer.
 */
const FAKE_NPM = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "\${FAKE_DIR}/npm-calls.log"
case "$1" in
  install) printf '%s' "\${3#npm@}" > "\${FAKE_DIR}/npm-installed" ;;
  --version) if [ -n "\${FAKE_NPM_VERSION:-}" ]; then echo "\${FAKE_NPM_VERSION}"; else cat "\${FAKE_DIR}/npm-installed"; fi ;;
esac
`;

/** Fields of a workflow step this suite reads. */
interface IStep {
  readonly id?: string;
  readonly name?: string;
  readonly if?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/** Fields of a concurrency setting this suite reads. */
interface IConcurrency {
  readonly group?: string;
  readonly 'cancel-in-progress'?: boolean | string;
  readonly queue?: string;
}

/** Fields of a workflow job this suite reads. */
interface IJob {
  readonly needs?: string | readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly if?: string;
  readonly concurrency?: IConcurrency;
  readonly steps: readonly IStep[];
}

/** Fake answers for one step run. */
interface IRunOptions {
  readonly env: Readonly<Record<string, string>>;
  readonly gh?: Readonly<Record<string, unknown>>;
  readonly nodeOutput?: unknown;
  readonly prList?: readonly unknown[];
  /** Files to place in RUNNER_TEMP before the step runs, by relative path. */
  readonly tempFiles?: Readonly<Record<string, unknown>>;
}

/** What a step run left behind. */
interface IStepRun {
  readonly status: number | null;
  readonly outputs: Readonly<Record<string, string>>;
  readonly ghCalls: readonly string[];
  readonly nodeCalls: readonly string[];
  readonly gitCalls: readonly string[];
  readonly stepSummary: string;
  readonly temp: string;
}

/** A fixture the fake gh serves as a paged list. */
interface IPaged {
  readonly fakePages: readonly unknown[];
}

let bin = '';
let work = '';

beforeAll(() => {
  bin = mkdtempSync(join(tmpdir(), 'workflow-gates-bin-'));
  writeExecutable(join(bin, 'gh'), FAKE_GH);
  writeExecutable(join(bin, 'git'), FAKE_GIT);
  writeExecutable(join(bin, 'node'), FAKE_NODE);
  writeExecutable(join(bin, 'npm'), FAKE_NPM);
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
 * Any expression that can reach a secret: the `secrets` context in any form,
 * or the `github` context other than through a property that is not `token`
 * (`toJSON(github)` holds the token too). Expression names ignore case.
 */
const SECRET_READ = /\bsecrets\b|\bgithub\b(?!\s*\.\s*(?!token\b)\w)/i;

/**
 * Reports whether a step runs the npm pin, however its path is spelled.
 * @param step - Workflow step.
 * @returns Whether it uses the pin-npm action.
 */
function usesPinNpm(step: IStep): boolean {
  return posix
    .normalize((step.uses ?? '').replace(/@.*$/, ''))
    .replace(/\/+$/, '')
    .endsWith(PIN_NPM);
}

/**
 * Lists the expressions a job evaluates: every `${{ }}` body in the job and
 * the workflow env it inherits, plus `if:` conditions, which may omit braces.
 * @param workflowEnv - The workflow-level env.
 * @param job - Workflow job.
 * @returns The expression bodies.
 */
function expressionsOf(workflowEnv: unknown, job: IJob): string[] {
  const braced = [...JSON.stringify([workflowEnv, job]).matchAll(/\$\{\{(.*?)\}\}/g)].map(([, body]) => body ?? '');
  const conditions = [job.if, ...(job.steps ?? []).map((step) => step.if)];
  return [...braced, ...conditions.filter((condition) => condition !== undefined)];
}

/**
 * Lists every job that runs the npm pin, in every workflow file of a folder.
 * @param dir - Folder of workflow files.
 * @returns Each pinned job as `file:job`, with whether it reads a secret.
 */
function pinnedJobs(dir: string): { job: string; readsSecret: boolean }[] {
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .flatMap((name) => {
      const workflow = parse(readFileSync(join(dir, name), 'utf8')) as { env?: unknown; jobs: Record<string, IJob> };
      return Object.entries(workflow.jobs)
        .filter(([, job]) => (job.steps ?? []).some(usesPinNpm))
        .map(([id, job]) => ({
          job: `${name}:${id}`,
          readsSecret: expressionsOf(workflow.env, job).some((expression) => SECRET_READ.test(expression)),
        }));
    });
}

/** The head a run's trigger carried: the commit its event was about. */
const TRIGGER_HEAD = /github\.event\.(?:workflow_run\.head_sha|pull_request\.head\.sha)/i;

/**
 * Reports whether a step leaves a pull request that has moved on to a later
 * run: it compares the head its trigger carried with another commit.
 * @param step - Workflow step.
 * @returns Whether the step can skip the current head as a stale one.
 */
function dropsMovedHeads(step: IStep): boolean {
  return Object.entries(step.env ?? {})
    .filter(([, value]) => TRIGGER_HEAD.test(String(value)))
    .some(([name]) => new RegExp(`!=\\s*"\\$\\{${name}\\}"|"\\$\\{${name}\\}"\\s*!=`).test(step.run ?? ''));
}

/**
 * Lists every job, in every workflow file of a folder, that waits on a lock
 * and leaves a moved head to a later run.
 * @param dir - Folder of workflow files.
 * @returns Each such job as `file:job`, with the lock it waits on.
 */
function headDroppingLocks(dir: string): { job: string; concurrency: unknown }[] {
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .flatMap((name) => {
      const workflow = parse(readFileSync(join(dir, name), 'utf8')) as { concurrency?: unknown; jobs: Record<string, IJob> };
      return Object.entries(workflow.jobs)
        .filter(([, job]) => (job.steps ?? []).some(dropsMovedHeads))
        .map(([id, job]) => ({ job: `${name}:${id}`, concurrency: job.concurrency ?? workflow.concurrency }))
        .filter(({ concurrency }) => concurrency !== undefined);
    });
}

/**
 * Lists every action definition in a repository, wherever it sits: a
 * workflow may run a local action from any `./path`, not only `.github/`.
 * @param root - Repository root.
 * @returns Each `action.yml` or `action.yaml`, tracked or not yet added.
 */
function actionFiles(root: string): string[] {
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (listed.status !== 0) throw new Error(`git ls-files failed in ${root}: ${listed.stderr}`);
  return listed.stdout.split('\0').filter((file) => /(^|\/)action\.ya?ml$/.test(file));
}

/**
 * Lists the action definitions that run the npm pin as one of their steps.
 * @param root - Repository root.
 * @returns Each nesting action's path.
 */
function nestedPins(root: string): string[] {
  return actionFiles(root).filter((file) => {
    const action = parse(readFileSync(join(root, file), 'utf8')) as { runs?: { steps?: IStep[] } };
    return (action.runs?.steps ?? []).some(usesPinNpm);
  });
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
  if (options.prList !== undefined) writeFileSync(join(work, 'pr-list'), JSON.stringify(options.prList));
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
  for (const [name, value] of Object.entries(options.tempFiles ?? {})) {
    mkdirSync(dirname(join(temp, name)), { recursive: true });
    writeFileSync(join(temp, name), JSON.stringify(value));
  }
  const outputFile = join(work, 'github-output');
  writeFileSync(outputFile, '');
  const summaryFile = join(work, 'step-summary');
  writeFileSync(summaryFile, '');
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
      GITHUB_STEP_SUMMARY: summaryFile,
      RUNNER_TEMP: temp,
      ...options.env,
    },
    timeout: 20_000,
  });
  return {
    status: result.status,
    outputs: parseOutputs(readFileSync(outputFile, 'utf8')),
    ghCalls: callsLogged('gh'),
    nodeCalls: callsLogged('node'),
    gitCalls: callsLogged('git'),
    stepSummary: readFileSync(summaryFile, 'utf8'),
    temp,
  };
}

/**
 * Reads the calls one fake logged during the current run.
 * @param fake - The fake's command name.
 * @returns One entry per call, oldest first.
 */
function callsLogged(fake: string): string[] {
  const log = join(work, `${fake}-calls.log`);
  return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
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
    [
      'the ruleset no longer restricts updates',
      {
        [rulesPath]: [{ type: 'update', ruleset_id: 7 }],
        [`repos/${REPO}/rulesets/7`]: ruleset({ rules: [{ type: 'deletion' }] }),
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
  const env = { BRANCH, GH_TOKEN: 'token', TITLE, BODY, MAJORS: '0', REQUIRES_REVIEW: 'false', LOCK_WHY: '' };
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

  it('labels a refresh whose override floors need review without arming it', () => {
    const run = runStep(step, { env: { ...env, REQUIRES_REVIEW: 'true', LOCKED: 'true' } });

    expect(run.status).toBe(0);
    expect(labelled(run.ghCalls)).toBe(true);
    expect(armed(run.ghCalls)).toBe(false);
  });

  it.each([
    ['missing', ''],
    ['not a boolean', 'yes'],
  ])('opens nothing when the review decision is %s', (_case, requiresReview) => {
    const run = runStep(step, { env: { ...env, REQUIRES_REVIEW: requiresReview, LOCKED: 'true' } });

    expect(run.status).toBe(1);
    expect(run.ghCalls).toEqual([]);
    expect(run.gitCalls).toEqual([]);
  });
});

describe.skipIf(!CAN_RUN)('lockfile refresh behind main', () => {
  const step = stepOf(REFRESH, 'behind', 'stale');
  const env = { GH_TOKEN: 'token' };
  const older = { number: 7, sha: 'c'.repeat(40) };
  const newer = { number: 8, sha: 'd'.repeat(40) };

  /**
   * Builds an open refresh pull request as `gh pr list --json` returns it.
   * @param pr - Its number and head commit.
   * @param pr.number - Pull request number.
   * @param pr.sha - Head commit.
   * @param overrides - Fields to replace.
   * @returns The listed pull request.
   */
  function listed(
    pr: { readonly number: number; readonly sha: string },
    overrides: Readonly<Record<string, unknown>> = {},
  ): Record<string, unknown> {
    const base = { number: pr.number, headRefName: `chore/lockfile-refresh-${String(pr.number)}`, headRefOid: pr.sha };
    return { ...base, isCrossRepository: false, ...overrides };
  }

  /**
   * Answers the comparison of a pull request's head with main.
   * @param pr - Its head commit.
   * @param pr.sha - Head commit.
   * @param commits - How many commits main is ahead.
   * @returns The `gh api` fixture.
   */
  function behindBy(pr: { readonly sha: string }, commits: number): Record<string, unknown> {
    return { [`repos/${REPO}/compare/main...${pr.sha}`]: { behind_by: commits } };
  }

  it.each([
    ['regenerates a refresh main has moved past', [listed(older)], behindBy(older, 2), 'true'],
    ['leaves a refresh that is up to date', [listed(older)], behindBy(older, 0), 'false'],
    ['does nothing when no refresh is open', [], {}, 'false'],
    ['skips a comparison it cannot read', [listed(older)], {}, 'false'],
    ['still regenerates when another refresh is behind', [listed(older), listed(newer)], behindBy(newer, 1), 'true'],
  ])('%s', (_case, prList, gh, stale) => {
    const run = runStep(step, { env, gh, prList });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({ stale });
  });

  it.each([
    ['a fork', { isCrossRepository: true }],
    ['another branch', { headRefName: 'dependabot/npm_and_yarn/katex-0.18.10' }],
  ])('never regenerates for a pull request from %s', (_case, overrides) => {
    const run = runStep(step, { env, gh: behindBy(older, 2), prList: [listed(older, overrides)] });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({ stale: 'false' });
    expect(run.ghCalls.filter((call) => call.startsWith('api '))).toEqual([]);
  });
});

describe('lockfile refresh four-hourly advisory watch', () => {
  const WATCH = '23 */4 * * *';
  const workflow = parse(readFileSync(join(ROOT, REFRESH), 'utf8')) as {
    on: { schedule: { cron: string }[] };
    jobs: Record<string, IJob & { permissions?: unknown; outputs?: Record<string, string> }>;
  };

  it('schedules the watch and gates the refresh on a red audit for that trigger alone', () => {
    const refresh = workflow.jobs.refresh;

    expect(workflow.on.schedule.map((entry) => entry.cron)).toEqual(['0 5 * * 4', WATCH]);
    expect(refresh?.needs).toEqual(['behind', 'advisory']);
    expect(refresh?.if).toContain('!cancelled()');
    expect(refresh?.if).toContain(`(github.event.schedule != '${WATCH}' || needs.advisory.outputs.red == 'true')`);
    expect(stepOf(REFRESH, 'refresh', 'same').if).toContain(`github.event.schedule == '${WATCH}'`);
  });

  it('runs the advisory job with the workflow token only, and only for the issue', () => {
    const advisory = workflow.jobs.advisory;

    expect(advisory?.permissions).toEqual({ contents: 'read', issues: 'write' });
    expect(advisory?.outputs).toEqual({ red: '${{ steps.audit.outputs.red }}' });
    expect(JSON.stringify(advisory)).not.toMatch(/secrets\./);
    const tokened = (advisory?.steps ?? []).filter((step) => step.env?.GH_TOKEN !== undefined);
    expect(tokened.map((step) => step.name)).toEqual(['Track unresolved advisories in an issue']);
  });

  it('prunes only on the weekly or a dispatched run', () => {
    expect(stepOf(REFRESH, 'refresh', 'prune').if).toBe(
      "github.event.schedule == '0 5 * * 4' || github.event_name == 'workflow_dispatch'",
    );
  });

  it('keeps every token out of the steps that edit the tree', () => {
    for (const id of ['prune', 'floors']) {
      expect(JSON.stringify(stepOf(REFRESH, 'refresh', id))).not.toMatch(/secrets\.|github\.token/);
    }
  });
});

describe.skipIf(!CAN_RUN)('lockfile refresh advisory audit', () => {
  const step = stepOf(REFRESH, 'advisory', 'audit');

  it.each([
    ['clean', '0', 'false'],
    ['in violation', '1', 'true'],
  ])('reports main as red only when its audit is %s', (_case, status, red) => {
    const run = runStep(step, { env: { FAKE_NODE_STATUS: status } });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({ red });
    expect(run.nodeCalls).toEqual(['config/check-audit.mjs']);
  });

  it('fails without a verdict when npm audit cannot produce a report', () => {
    const run = runStep(step, { env: { FAKE_NODE_STATUS: '2' } });

    expect(run.status).toBe(1);
    expect(run.outputs).toEqual({});
  });
});

describe.skipIf(!CAN_RUN)('lockfile refresh advisory plan', () => {
  const step = stepOf(REFRESH, 'advisory', 'plan');
  const plan = {
    floors: [{ package: 're2js', floor: '^2.8.7', kind: 'in-line', ghsas: ['GHSA-gg6h-894w-4m9c'] }],
    rejections: [{ package: 'foo', reason: 'no-fixed-release', ghsas: ['GHSA-x'] }],
  };

  it('plans read-only and reports every floor and rejection', () => {
    const run = runStep(step, { env: {}, nodeOutput: plan });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({ planned: 'true' });
    expect(run.nodeCalls).toEqual(['scripts/plan-override-floors.mjs --apply']);
    expect(run.stepSummary).toContain('- re2js: ^2.8.7 (in-line) for GHSA-gg6h-894w-4m9c');
    expect(run.stepSummary).toContain('- foo: rejected (no-fixed-release) for GHSA-x');
  });

  it.each([
    ['the planner fails', { FAKE_NODE_STATUS: '1' }, plan],
    ['the plan lacks its rejections', {}, { floors: [] }],
  ])('leaves the issue alone when %s', (_case, env, nodeOutput) => {
    const run = runStep(step, { env, nodeOutput });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({ planned: 'false' });
  });
});

describe.skipIf(!CAN_RUN)('lockfile refresh advisory issue', () => {
  const step = stepOf(REFRESH, 'advisory', 'issue');
  const listPath = `repos/${REPO}/issues?state=open&labels=blocked-by-advisory&per_page=100`;
  const tracking = { number: 9, title: 'Unresolved dependency advisories', user: { login: 'github-actions[bot]' } };
  const rejected = { floors: [], rejections: [{ package: 'foo', reason: 'no-fixed-release', ghsas: ['GHSA-x'] }] };
  const writes = (calls: readonly string[]): string[] => calls.filter((call) => /^(api -X|label create)/.test(call));

  it('closes the tracking issue once main audits clean', () => {
    const run = runStep(step, { env: { GH_TOKEN: 'token', RED: 'false' }, gh: { [listPath]: [tracking] } });

    expect(run.status).toBe(0);
    expect(run.ghCalls.some((call) => call.startsWith(`api -X POST repos/${REPO}/issues/9/comments`))).toBe(true);
    expect(run.ghCalls).toContain(`api -X PATCH repos/${REPO}/issues/9 -f state=closed -f state_reason=completed`);
  });

  it('writes nothing when main is clean and no tracking issue is open', () => {
    const run = runStep(step, { env: { GH_TOKEN: 'token', RED: 'false' }, gh: { [listPath]: [] } });

    expect(run.status).toBe(0);
    expect(writes(run.ghCalls)).toEqual([]);
  });

  it('opens a labelled issue listing each advisory no floor can clear', () => {
    const run = runStep(step, {
      env: { GH_TOKEN: 'token', RED: 'true' },
      gh: { [listPath]: [] },
      tempFiles: { 'plan.json': rejected },
    });

    expect(run.status).toBe(0);
    expect(run.ghCalls.some((call) => call.startsWith('label create blocked-by-advisory'))).toBe(true);
    const opened = run.ghCalls.join('\n');
    expect(opened).toContain(`api -X POST repos/${REPO}/issues -f title=Unresolved dependency advisories`);
    expect(opened).toContain('| `foo` | GHSA-x | no-fixed-release |');
    expect(opened).toContain('-f labels[]=blocked-by-advisory');
  });

  it('updates the open tracking issue instead of opening another', () => {
    const run = runStep(step, {
      env: { GH_TOKEN: 'token', RED: 'true' },
      gh: { [listPath]: [tracking] },
      tempFiles: { 'plan.json': rejected },
    });

    expect(run.status).toBe(0);
    expect(run.ghCalls.some((call) => call.startsWith(`api -X PATCH repos/${REPO}/issues/9 -f body=`))).toBe(true);
    expect(run.ghCalls.some((call) => call.startsWith(`api -X POST repos/${REPO}/issues `))).toBe(false);
  });

  it.each([
    ['a pull request', { ...tracking, pull_request: {} }],
    ['a human', { ...tracking, user: { login: 'someone' } }],
    ['another title', { ...tracking, title: 'Something else' }],
  ])('never edits or closes an item opened by %s', (_case, item) => {
    const clean = runStep(step, { env: { GH_TOKEN: 'token', RED: 'false' }, gh: { [listPath]: [item] } });
    expect(writes(clean.ghCalls)).toEqual([]);

    const red = runStep(step, {
      env: { GH_TOKEN: 'token', RED: 'true' },
      gh: { [listPath]: [item] },
      tempFiles: { 'plan.json': rejected },
    });
    expect(red.ghCalls.some((call) => call.includes(`issues/${String(item.number)}`))).toBe(false);
  });

  it('writes nothing while every advisory on a red main has a floor', () => {
    const run = runStep(step, {
      env: { GH_TOKEN: 'token', RED: 'true' },
      gh: { [listPath]: [] },
      tempFiles: { 'plan.json': { floors: [{ package: 're2js' }], rejections: [] } },
    });

    expect(run.status).toBe(0);
    expect(writes(run.ghCalls)).toEqual([]);
  });

  it.each([
    ['no review', false, 'no floor needs review; the lockfile refresh pull request carries them, and is held for a maintainer only if another change'],
    ['a review', true, 'labelled `needs-manual-review` and waits for a maintainer'],
    ['an unstated review', undefined, 'labelled `needs-manual-review` and waits for a maintainer'],
  ])('replaces the open issue\'s rejection table, keeping it open, once every advisory has a floor needing %s', (_case, requiresReview, status) => {
    const run = runStep(step, {
      env: { GH_TOKEN: 'token', RED: 'true' },
      gh: { [listPath]: [tracking] },
      tempFiles: { 'plan.json': { floors: [{ package: 're2js' }], rejections: [], requiresReview } },
    });

    expect(run.status).toBe(0);
    const patched = writes(run.ghCalls);
    expect(patched).toEqual([expect.stringMatching(new RegExp(`^api -X PATCH repos/${REPO}/issues/9 -f body=`))]);
    expect(patched[0]).toContain('Every advisory now has an `overrides` floor');
    expect(patched[0]).toContain(status);
    expect(patched[0]).not.toContain('| Package |');
  });
});

describe.skipIf(!CAN_RUN)('lockfile refresh override floors', () => {
  const step = stepOf(REFRESH, 'refresh', 'floors');
  const floor = { package: 're2js', floor: '^2.8.7', kind: 'in-line', ghsas: ['GHSA-gg6h-894w-4m9c'] };

  it.each([
    ['an in-line floor', { floors: [floor], rejections: [], requiresReview: false }, 'true', 'true', 'false'],
    ['a fresh floor', { floors: [{ ...floor, kind: 'fresh' }], rejections: [], requiresReview: true }, 'true', 'true', 'true'],
    ['only a rejection', { floors: [], rejections: [{ package: 'foo', reason: 'x', ghsas: ['G'] }], requiresReview: true }, 'false', 'false', 'true'],
    ['a clean tree', { floors: [], rejections: [], requiresReview: false }, 'true', 'false', 'false'],
  ])('publishes the verdict for %s', (_case, nodeOutput, complete, changed, review) => {
    const run = runStep(step, { env: {}, nodeOutput });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({ complete, overrides_changed: changed, requires_review: review });
    expect(run.nodeCalls).toEqual(['scripts/plan-override-floors.mjs --apply']);
    expect(existsSync(join(run.temp, 'floors.json'))).toBe(true);
  });

  it.each([
    ['the planner fails', { FAKE_NODE_STATUS: '1' }, { floors: [], rejections: [], requiresReview: false }],
    ['the plan lacks requiresReview', {}, { floors: [floor], rejections: [] }],
  ])('carries no floor and keeps no plan when %s', (_case, env, nodeOutput) => {
    const run = runStep(step, { env, nodeOutput });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({ complete: 'false', overrides_changed: 'false', requires_review: 'false' });
    expect(existsSync(join(run.temp, 'floors.json'))).toBe(false);
  });

  it('closes stale refreshes on an unchanged tree only once the planner finished with no rejection', () => {
    const supersede = jobsOf(REFRESH).refresh?.steps.find((candidate) => candidate.name === 'Supersede stale refresh pull requests');

    expect(supersede?.if).toContain("(steps.diff.outputs.changed == 'false' && steps.floors.outputs.complete == 'true')");
  });

  it('reports each floor in the step summary', () => {
    const run = runStep(step, { env: {}, nodeOutput: { floors: [floor], rejections: [], requiresReview: false } });

    expect(run.stepSummary).toContain('- re2js: ^2.8.7 (in-line) for GHSA-gg6h-894w-4m9c');
  });
});

describe.skipIf(!CAN_RUN)('lockfile refresh prune', () => {
  const step = stepOf(REFRESH, 'refresh', 'prune');

  it('keeps the prune result and reports each dropped override', () => {
    const run = runStep(step, { env: {}, nodeOutput: { pruned: ['uuid'], kept: [] } });

    expect(run.status).toBe(0);
    expect(run.nodeCalls).toEqual(['scripts/plan-override-floors.mjs --prune']);
    expect(existsSync(join(run.temp, 'prune.json'))).toBe(true);
    expect(run.stepSummary).toContain('- uuid: dropped');
  });

  it.each([
    ['pruning fails', { FAKE_NODE_STATUS: '1' }, { pruned: [] }],
    ['the result lacks its list', {}, { kept: [] }],
  ])('keeps every override when %s', (_case, env, nodeOutput) => {
    const run = runStep(step, { env, nodeOutput });

    expect(run.status).toBe(0);
    expect(existsSync(join(run.temp, 'prune.json'))).toBe(false);
  });
});

describe.skipIf(!CAN_RUN)('lockfile refresh change detection', () => {
  const step = stepOf(REFRESH, 'refresh', 'diff');

  it.each([
    ['nothing', '', 'false'],
    ['the lockfile', 'package-lock.json', 'true'],
    ['only package.json, as a prune does', 'package.json', 'true'],
  ])('reports a change when %s moved', (_case, modified, changed) => {
    const run = runStep(step, { env: { FAKE_GIT_DIFF: modified } });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({ changed });
  });
});

describe.skipIf(!CAN_RUN)('lockfile refresh manifest guard', () => {
  const step = stepOf(REFRESH, 'refresh', 'verify');

  it('accepts a lockfile-only change without consulting the planner', () => {
    const run = runStep(step, { env: { FAKE_GIT_DIFF: 'package-lock.json' } });

    expect(run.status).toBe(0);
    expect(run.nodeCalls).toEqual([]);
  });

  it('vets a package.json change against the plan and prune result it was given', () => {
    const run = runStep(step, {
      env: { FAKE_GIT_DIFF: 'package-lock.json package.json' },
      tempFiles: { 'floors.json': {}, 'prune.json': {} },
    });

    expect(run.status).toBe(0);
    expect(run.nodeCalls).toEqual([
      `scripts/plan-override-floors.mjs --verify-manifest ${run.temp}/package.before.json --plan ${run.temp}/floors.json --prune-result ${run.temp}/prune.json`,
    ]);
  });

  it('allows no override key at all when neither step left a result', () => {
    const run = runStep(step, { env: { FAKE_GIT_DIFF: 'package.json' } });

    expect(run.nodeCalls).toEqual([`scripts/plan-override-floors.mjs --verify-manifest ${run.temp}/package.before.json`]);
  });

  it('fails when the planner rejects the package.json change', () => {
    const run = runStep(step, { env: { FAKE_GIT_DIFF: 'package.json', FAKE_NODE_STATUS: '1' } });

    expect(run.status).toBe(1);
  });

  it('fails on any other modified file before vetting the manifest', () => {
    const run = runStep(step, { env: { FAKE_GIT_DIFF: 'package.json .npmrc' } });

    expect(run.status).toBe(1);
    expect(run.nodeCalls).toEqual([]);
  });
});

describe.skipIf(!CAN_RUN)('lockfile refresh summary inputs and commit', () => {
  const summary = stepOf(REFRESH, 'refresh', 'summary');
  const nodeOutput = { title: TITLE, body: BODY, majorBumps: [] };

  it('summarises the lockfiles alone when neither override step left a result', () => {
    const run = runStep(summary, { env: {}, nodeOutput });

    expect(run.nodeCalls).toEqual([`scripts/summarize-refresh.mjs ${run.temp}/before.json package-lock.json`]);
  });

  it('hands the summary the plan and prune result when both exist', () => {
    const run = runStep(summary, { env: {}, nodeOutput, tempFiles: { 'floors.json': {}, 'prune.json': {} } });

    expect(run.nodeCalls).toEqual([
      `scripts/summarize-refresh.mjs ${run.temp}/before.json package-lock.json --floors ${run.temp}/floors.json --prune ${run.temp}/prune.json`,
    ]);
  });

  it('stages package.json alongside the lockfile', () => {
    const commit = jobsOf(REFRESH).refresh?.steps.find((step) => step.name === 'Commit the refresh');
    if (commit === undefined) throw new Error('no commit step');

    const run = runStep(commit, { env: { TITLE, BRANCH } });

    expect(run.status).toBe(0);
    expect(run.gitCalls).toContain('add package-lock.json package.json');
  });
});

describe.skipIf(!CAN_RUN)('lockfile refresh idempotency', () => {
  const step = stepOf(REFRESH, 'refresh', 'same');
  const sha = 'e'.repeat(40);
  const blobs = { FAKE_MANIFEST_BLOB: 'm'.repeat(40), FAKE_LOCK_BLOB: 'l'.repeat(40) };
  const env = { GH_TOKEN: 'token', MAJORS: '0', REQUIRES_REVIEW: 'false', ...blobs };
  const tree = (manifest: string, lock: string): Record<string, unknown> => ({
    [`repos/${REPO}/git/trees/${sha}`]: {
      tree: [
        { path: 'README.md', sha: 'r'.repeat(40) },
        { path: 'package.json', sha: manifest },
        { path: 'package-lock.json', sha: lock },
      ],
    },
  });
  const identical = tree(blobs.FAKE_MANIFEST_BLOB, blobs.FAKE_LOCK_BLOB);
  const upToDate = { [`repos/${REPO}/compare/main...${sha}`]: { behind_by: 0 } };

  /**
   * Builds an open refresh pull request as `gh pr list --json` returns it.
   * @param overrides - Fields to replace.
   * @returns The listed pull request.
   */
  function open(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
    const base = { number: 7, headRefName: 'chore/lockfile-refresh-7', headRefOid: sha, isCrossRepository: false };
    return { ...base, labels: [], autoMergeRequest: { mergeMethod: 'SQUASH' }, ...overrides };
  }

  it('opens nothing when an up-to-date refresh carries the same files and review state', () => {
    const run = runStep(step, { env, gh: { ...identical, ...upToDate }, prList: [open()] });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({ skip: 'true' });
  });

  it('matches a labelled refresh when this run also needs review', () => {
    const labels = [{ name: 'needs-manual-review' }];
    const run = runStep(step, {
      env: { ...env, REQUIRES_REVIEW: 'true' },
      gh: { ...identical, ...upToDate },
      prList: [open({ labels, autoMergeRequest: null })],
    });

    expect(run.outputs).toEqual({ skip: 'true' });
  });

  it.each([
    ['its lockfile differs', { prList: [open()], gh: { ...tree(blobs.FAKE_MANIFEST_BLOB, 'x'.repeat(40)), ...upToDate } }],
    ['its manifest differs', { prList: [open()], gh: { ...tree('x'.repeat(40), blobs.FAKE_LOCK_BLOB), ...upToDate } }],
    ['main moved past it', { prList: [open()], gh: { ...identical, [`repos/${REPO}/compare/main...${sha}`]: { behind_by: 1 } } }],
    ['it is labelled but this run would arm', { prList: [open({ labels: [{ name: 'needs-manual-review' }] })], gh: { ...identical, ...upToDate } }],
    ['this run would arm but its arming failed', { prList: [open({ autoMergeRequest: null })], gh: { ...identical, ...upToDate } }],
    ['its tree cannot be read', { prList: [open()], gh: upToDate }],
    ['its comparison cannot be read', { prList: [open()], gh: identical }],
    ['it comes from a fork', { prList: [open({ isCrossRepository: true })], gh: { ...identical, ...upToDate } }],
    ['it is not a refresh branch', { prList: [open({ headRefName: 'feature' })], gh: { ...identical, ...upToDate } }],
    ['none is open', { prList: [], gh: {} }],
  ])('opens a new refresh when %s', (_case, fixtures) => {
    const run = runStep(step, { env, ...fixtures });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({ skip: 'false' });
  });

  it('treats a run that crossed a major as needing review', () => {
    const run = runStep(step, { env: { ...env, MAJORS: '1' }, gh: { ...identical, ...upToDate }, prList: [open()] });

    expect(run.outputs).toEqual({ skip: 'false' });
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

  it('keeps every waiting run in a lock whose runs leave a moved head to a later run', () => {
    const locks = headDroppingLocks(join(ROOT, '.github/workflows'));
    const dropping = locks.filter(({ concurrency }) => {
      const lock = typeof concurrency === 'object' && concurrency !== null ? (concurrency as IConcurrency) : {};
      return lock.queue !== 'max' || lock['cancel-in-progress'] !== false;
    });

    expect(locks.map(({ job }) => job)).toContain('dependabot-auto-merge.yml:automerge');
    expect(dropping.map(({ job }) => job)).toEqual([]);
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
   * Builds the run list as the API pages it, each page carrying the total
   * GitHub reports; the fake gh serves the pages as `--paginate` asks.
   * @param pages - The runs on each page.
   * @param total - The total count GitHub reports; defaults to every run.
   * @returns The paged fixture.
   */
  function listing(pages: readonly (readonly Record<string, unknown>[])[], total = pages.flat().length): IPaged {
    return { fakePages: pages.map((runs) => ({ total_count: total, workflow_runs: runs })) };
  }

  /**
   * Fixtures for an open Dependabot pull request.
   * @param commits - The pull request's commits, oldest first.
   * @param runs - PR Pipeline run pages for its head, or `null` for an API error.
   * @returns The `gh api` fixtures.
   */
  function pullRequest(
    commits: readonly Record<string, unknown>[],
    runs: IPaged | null = listing([[passed]]),
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
      '300',
    ],
    [
      'the newest run failed after a pass',
      [ciRun(299, '2026-05-04T08:01:00Z', 'success'), ciRun(300, '2026-05-04T08:15:00Z', 'failure')],
      'failure',
      '300',
    ],
    [
      'an older run was re-run last',
      [ciRun(299, '2026-05-04T08:40:00Z', 'success'), ciRun(300, '2026-05-04T08:15:00Z', 'failure')],
      'success',
      '299',
    ],
    [
      'two runs started the same second',
      [ciRun(301, '2026-05-04T08:15:00Z', 'failure'), ciRun(300, '2026-05-04T08:15:00Z', 'success')],
      'failure',
      '301',
    ],
    ['the newest run is in progress', [passed, ciRun(301, '2026-05-04T08:30:00Z', null)], 'pending', '301'],
    ['no run exists yet', [], 'pending', ''],
  ])('publishes the CI verdict and the run it came from when %s', (_case, runs, verdict, runId) => {
    const run = runStep(step, { env, gh: pullRequest([dependabotCommit(HEAD_SHA, message)], listing([runs])) });

    expect(run.status).toBe(0);
    expect(run.outputs).toMatchObject({ number: '5', skip: 'false', disarm: 'false', ci: verdict, ci_run_id: runId });
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

describe.skipIf(!CAN_RUN)('Dependabot auto-merge advisory label reconcile', () => {
  const step = stepOf(AUTOMERGE, 'automerge', 'reconcile');
  const env = { PR_NUMBER: '5', GH_TOKEN: 'write', READ_TOKEN: 'read' };
  const pull = `repos/${REPO}/pulls/5`;
  const removal = `api -X DELETE repos/${REPO}/issues/5/labels/blocked-by-advisory`;

  it('runs on every verdict for a head the run owns', () => {
    expect(step.if).toBe("steps.resolve.outputs.skip == 'false'");
  });

  it('removes the label a verdict on an earlier head left', () => {
    const labels = [{ name: 'dependencies' }, { name: 'blocked-by-advisory' }];

    const run = runStep(step, { env, gh: { [pull]: { labels } } });

    expect(run.status).toBe(0);
    expect(run.ghCalls).toContain(removal);
    expect(run.stepSummary).toBe('- #5: blocked-by-advisory label removed\n');
  });

  it.each([
    ['carries no such label', { [pull]: { labels: [{ name: 'dependencies' }] } }],
    ['cannot have its labels read', {}],
  ])('removes nothing from a pull request that %s', (_case, gh) => {
    const run = runStep(step, { env, gh });

    expect(run.status).toBe(0);
    expect(run.ghCalls).not.toContain(removal);
  });
});

describe.skipIf(!CAN_RUN)('Dependabot auto-merge advisory triage', () => {
  const find = stepOf(AUTOMERGE, 'automerge', 'auditfail');
  const fetch = stepOf(AUTOMERGE, 'automerge', 'base');
  const audit = stepOf(AUTOMERGE, 'automerge', 'baseaudit');
  const label = stepOf(AUTOMERGE, 'automerge', 'block');
  const baseSha = 'd'.repeat(40);
  const jobsPath = `repos/${REPO}/actions/runs/300/jobs?per_page=100`;
  const comparePath = `repos/${REPO}/compare/main...${HEAD_SHA}`;
  const manifestPath = `repos/${REPO}/contents/package.json?ref=${baseSha}`;
  const lockPath = `repos/${REPO}/contents/package-lock.json?ref=${baseSha}`;

  /**
   * Builds the jobs of a PR Pipeline run whose audit step concluded as
   * given, beside another job whose step of the same name failed.
   * @param conclusion - Conclusion of the Build & Audit job's audit step.
   * @returns The jobs as the run-jobs API lists them.
   */
  function ciJobs(conclusion: string): Record<string, unknown> {
    return {
      jobs: [
        {
          name: 'Build & Audit',
          steps: [
            { name: 'Release signal guard', conclusion: 'success' },
            { name: 'Audit dependencies', conclusion },
          ],
        },
        { name: 'Unit Tests', steps: [{ name: 'Audit dependencies', conclusion: 'failure' }] },
      ],
    };
  }

  it('triages only a failed verdict on a head it vetted', () => {
    expect(find.if).toContain("steps.resolve.outputs.skip == 'false'");
    expect(find.if).toContain("steps.resolve.outputs.disarm != 'true'");
    expect(find.if).toContain("steps.resolve.outputs.ci == 'failure'");
  });

  it('looks for the job and step PR Pipeline names', () => {
    const pipeline = jobsOf('.github/workflows/pr.yml');
    const build = Object.values(pipeline).find((job) => (job as { name?: string }).name === 'Build & Audit');
    const step = build?.steps.find((candidate) => candidate.name === 'Audit dependencies');

    expect(step?.run).toBe('npm run audit');
    expect(find.run).toContain('select(.name == "Build & Audit")');
    expect(find.run).toContain('select(.name == "Audit dependencies")');
  });

  it.each([
    ['failure', { failed: 'true' }],
    ['success', {}],
    ['skipped', {}],
  ])('flags the run only when its own audit step concluded failure (%s)', (conclusion, outputs) => {
    const run = runStep(find, { env: { PR_NUMBER: '5', CI_RUN_ID: '300' }, gh: { [jobsPath]: ciJobs(conclusion) } });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual(outputs);
  });

  it.each([
    ['its jobs cannot be read', '300'],
    ['no run produced the verdict', ''],
  ])('flags nothing when %s', (_case, runId) => {
    const run = runStep(find, { env: { PR_NUMBER: '5', CI_RUN_ID: runId }, gh: {} });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({});
  });

  const fetchEnv = { PR_NUMBER: '5', HEAD_SHA, BASE_BRANCH: 'main', GH_TOKEN: 'read' };
  const baseFiles = {
    [comparePath]: { merge_base_commit: { sha: baseSha } },
    [manifestPath]: { name: 'importer' },
    [lockPath]: { lockfileVersion: 3 },
  };

  it('fetches both manifests at the merge base', () => {
    const run = runStep(fetch, { env: fetchEnv, gh: baseFiles });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({ ready: 'true', sha: baseSha });
    expect(JSON.parse(readFileSync(join(run.temp, 'base/package-lock.json'), 'utf8'))).toEqual({ lockfileVersion: 3 });
    expect(run.ghCalls.filter((call) => call.includes('/contents/'))).toEqual([
      `api -H Accept: application/vnd.github.raw+json ${manifestPath}`,
      `api -H Accept: application/vnd.github.raw+json ${lockPath}`,
    ]);
  });

  it.each([
    ['the comparison fails', comparePath, undefined],
    ['the merge base is missing', comparePath, { merge_base_commit: null }],
    ['the lockfile cannot be read', lockPath, undefined],
  ])('readies nothing when %s', (_case, path, answer) => {
    const gh: Record<string, unknown> = { ...baseFiles };
    if (answer === undefined) delete gh[path];
    else gh[path] = answer;

    const run = runStep(fetch, { env: fetchEnv, gh });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({});
  });

  it('audits the merge base with no token in reach', () => {
    expect(Object.values(audit.env ?? {}).some((value) => SECRET_READ.test(value))).toBe(false);
  });

  it.each([
    ['0', {}],
    ['1', { blocked: 'true' }],
    ['2', {}],
  ])('blocks only when the merge-base audit exits 1 (exit %s)', (status, outputs) => {
    const run = runStep(audit, {
      env: { PR_NUMBER: '5', BASE_SHA: baseSha, GITHUB_WORKSPACE: '/workspace', FAKE_NODE_STATUS: status },
      tempFiles: { 'base/package-lock.json': {} },
    });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual(outputs);
    expect(run.nodeCalls).toEqual(['/workspace/config/check-audit.mjs']);
    expect(readFileSync(join(run.temp, '..', 'node-cwd.log'), 'utf8').trim()).toBe(join(run.temp, 'base'));
  });

  it('labels the pull request blocked by an advisory on its base', () => {
    const run = runStep(label, { env: { PR_NUMBER: '5', BASE_SHA: baseSha, GH_TOKEN: 'write' } });

    expect(run.status).toBe(0);
    expect(run.ghCalls).toContain(`api -X POST repos/${REPO}/issues/5/labels -f labels[]=blocked-by-advisory`);
    expect(run.stepSummary).toBe('- #5: labelled blocked-by-advisory\n');
  });

  it('labels only on a blocking audit, and a failed label write withdraws any arming', () => {
    const catchAll = jobsOf(AUTOMERGE).automerge?.steps.find((step) => step.name === 'Withdraw auto-merge when a write step failed');

    expect(label.if).toBe("steps.baseaudit.outputs.blocked == 'true'");
    expect(catchAll?.if).toContain("steps.block.outcome == 'failure'");
  });

  it('creates the label exactly as the lockfile refresh does', () => {
    const creation = (file: string): string[] =>
      [...readFileSync(join(ROOT, file), 'utf8').matchAll(/gh label create blocked-by-advisory[^']*'[^']*'/g)].map(([text]) =>
        text.replace(/\s*\\\s*/g, ' '),
      );

    expect(creation(AUTOMERGE)).toEqual(creation(REFRESH));
    expect(creation(AUTOMERGE)).toHaveLength(1);
  });
});

describe.skipIf(!CAN_RUN)('Dependabot rebase main audit', () => {
  const job = jobsOf(AUTOMERGE)['rebase-behind'];
  const step = stepOf(AUTOMERGE, 'rebase-behind', 'audit');

  it.each([
    ['0', 'true'],
    ['1', 'false'],
    ['2', 'false'],
  ])('reports main clean only when its audit exits 0 (exit %s)', (status, clean) => {
    const run = runStep(step, { env: { FAKE_NODE_STATUS: status } });

    expect(run.status).toBe(0);
    expect(run.outputs).toEqual({ clean });
    expect(run.nodeCalls).toEqual(['config/check-audit.mjs']);
  });

  it('holds RELEASE_TOKEN in the nudge step alone', () => {
    const holders = (job?.steps ?? []).filter((candidate) => SECRET_READ.test(JSON.stringify(candidate)));

    expect(SECRET_READ.test(JSON.stringify(job?.env ?? {}))).toBe(false);
    expect(holders.map((candidate) => candidate.id)).toEqual(['nudge']);
  });

  it('nudges armed pull requests even when the audit could not run', () => {
    expect(stepOf(AUTOMERGE, 'rebase-behind', 'nudge').if).toContain('!cancelled()');
  });
});

describe.skipIf(!CAN_RUN)('Dependabot rebase nudge', () => {
  const step = stepOf(AUTOMERGE, 'rebase-behind', 'nudge');
  const first = { number: 11, sha: 'b'.repeat(40) };
  const second = { number: 12, sha: 'c'.repeat(40) };
  const armed = { enabledAt: '2026-05-04T07:00:00Z' };
  const prList = [
    { number: first.number, headRefOid: first.sha, autoMergeRequest: armed },
    { number: second.number, headRefOid: second.sha, autoMergeRequest: armed },
  ];
  const env = { MAIN_CLEAN: 'false' };

  /**
   * Fixtures for an armed pull request three commits behind main, never
   * nudged since its head was committed.
   * @param pr - Its number and head commit.
   * @param pr.number - Pull request number.
   * @param pr.sha - Head commit.
   * @returns The `gh api` fixtures.
   */
  function behindMain(pr: { readonly number: number; readonly sha: string }): Record<string, unknown> {
    return {
      [`repos/${REPO}/compare/main...${pr.sha}`]: { behind_by: 3 },
      [`repos/${REPO}/commits/${pr.sha}`]: { commit: { committer: { date: '2026-05-04T08:00:00Z' } } },
      [`repos/${REPO}/issues/${pr.number}/comments`]: [],
    };
  }

  /**
   * Lists the pull requests a run asked Dependabot to rebase.
   * @param run - The step run.
   * @returns The nudged pull request numbers.
   */
  function nudged(run: IStepRun): string[] {
    return run.ghCalls.filter((call) => call.startsWith('pr comment ')).map((call) => call.split(' ')[2] ?? '');
  }

  it('nudges the oldest armed pull request behind main', () => {
    const gh = { user: { login: 'owner' }, ...behindMain(first), ...behindMain(second) };

    const run = runStep(step, { env, gh, prList });

    expect(run.status).toBe(0);
    expect(nudged(run)).toEqual(['11']);
  });

  /**
   * Formats a time the given number of hours ago as GitHub does.
   * @param hours - Hours before now.
   * @returns The ISO-8601 UTC timestamp, without milliseconds.
   */
  function hoursAgo(hours: number): string {
    return new Date(Date.now() - hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  /**
   * Fixtures for both pull requests behind main, the first already nudged.
   * @param times - When each earlier nudge on the first was posted.
   * @returns The `gh api` fixtures.
   */
  function nudgedAt(times: readonly string[]): Record<string, unknown> {
    const comments = times.map((created_at) => ({ user: { login: 'owner' }, body: '@dependabot rebase', created_at }));
    return {
      user: { login: 'owner' },
      ...behindMain(first),
      ...behindMain(second),
      [`repos/${REPO}/issues/${first.number}/comments`]: comments,
    };
  }

  it.each([
    ['waits on a pull request nudged under two hours ago', [hoursAgo(1)], []],
    ['nudges a pull request once more after two hours', [hoursAgo(3)], ['11']],
    ['moves on after two unanswered nudges', [hoursAgo(5), hoursAgo(3)], ['12']],
    ['ignores nudges made before the head commit', ['2026-05-04T07:00:00Z', '2026-05-04T07:30:00Z'], ['11']],
  ])('%s', (_case, times, expected) => {
    const run = runStep(step, { env, gh: nudgedAt(times), prList });

    expect(run.status).toBe(0);
    expect(nudged(run)).toEqual(expected);
  });

  it('reads past a comment that has no body', () => {
    const gh = {
      user: { login: 'owner' },
      ...behindMain(first),
      ...behindMain(second),
      [`repos/${REPO}/issues/${first.number}/comments`]: [{ user: { login: 'owner' }, body: null, created_at: '2026-05-04T09:00:00Z' }],
    };

    const run = runStep(step, { env, gh, prList });

    expect(run.status).toBe(0);
    expect(nudged(run)).toEqual(['11']);
  });

  it.each([
    ['its comparison with main fails', `repos/${REPO}/compare/main...${first.sha}`, undefined],
    ['its head commit cannot be read', `repos/${REPO}/commits/${first.sha}`, undefined],
    ['its head commit carries no date', `repos/${REPO}/commits/${first.sha}`, { commit: { committer: {} } }],
    [
      'its head commit carries an impossible date',
      `repos/${REPO}/commits/${first.sha}`,
      { commit: { committer: { date: '2026-99-99T99:99:99Z' } } },
    ],
    ['its comments cannot be read', `repos/${REPO}/issues/${first.number}/comments`, undefined],
    ['its comments are not a list', `repos/${REPO}/issues/${first.number}/comments`, { message: 'Bad gateway' }],
    ['a page of its comments is not a list', `repos/${REPO}/issues/${first.number}/comments`, { fakePages: [[], null] }],
    [
      'an earlier rebase request carries no readable date',
      `repos/${REPO}/issues/${first.number}/comments`,
      [{ user: { login: 'owner' }, body: '@dependabot rebase', created_at: '9999' }],
    ],
    [
      'an earlier rebase request carries an impossible date',
      `repos/${REPO}/issues/${first.number}/comments`,
      [{ user: { login: 'owner' }, body: '@dependabot rebase', created_at: '2026-99-99T99:99:99Z' }],
    ],
  ])('skips a pull request when %s and nudges the next', (_case, path, answer) => {
    const gh: Record<string, unknown> = { user: { login: 'owner' }, ...behindMain(first), ...behindMain(second) };
    if (answer === undefined) delete gh[path];
    else gh[path] = answer;

    const run = runStep(step, { env, gh, prList });

    expect(run.status).toBe(0);
    expect(nudged(run)).toEqual(['12']);
  });

  const blocked = { number: 10, sha: 'd'.repeat(40) };

  /**
   * Lists an unarmed pull request ahead of the two armed ones.
   * @param labels - Labels on the unarmed pull request.
   * @returns The pull request list.
   */
  function withUnarmed(labels: readonly string[]): unknown[] {
    const unarmed = { number: blocked.number, headRefOid: blocked.sha, autoMergeRequest: null, labels: labels.map((name) => ({ name })) };
    return [unarmed, ...prList];
  }

  it('nudges a blocked pull request in number order once main audits clean, leaving its label on', () => {
    const gh = { user: { login: 'owner' }, ...behindMain(blocked), ...behindMain(first), ...behindMain(second) };

    const run = runStep(step, { env: { MAIN_CLEAN: 'true' }, gh, prList: withUnarmed(['blocked-by-advisory']) });

    expect(run.status).toBe(0);
    expect(nudged(run)).toEqual(['10']);
    expect(run.ghCalls.filter((call) => /-X (?:POST|DELETE)/.test(call))).toEqual([]);
    expect(run.stepSummary).toBe('- #10: asked Dependabot to rebase past the advisory main no longer carries\n');
  });

  it.each([
    ['a blocked pull request while main audits red', ['blocked-by-advisory'], 'false'],
    ['a blocked pull request while main went unaudited', ['blocked-by-advisory'], ''],
    ['an unlabelled unarmed pull request', ['dependencies'], 'true'],
  ])('leaves %s alone', (_case, labels, clean) => {
    const gh = { user: { login: 'owner' }, ...behindMain(blocked), ...behindMain(first), ...behindMain(second) };

    const run = runStep(step, { env: { MAIN_CLEAN: clean }, gh, prList: withUnarmed(labels) });

    expect(run.status).toBe(0);
    expect(nudged(run)).toEqual(['11']);
  });

  it('skips a blocked pull request that is not behind main and nudges the next', () => {
    const gh = {
      user: { login: 'owner' },
      ...behindMain(blocked),
      [`repos/${REPO}/compare/main...${blocked.sha}`]: { behind_by: 0 },
      ...behindMain(first),
      ...behindMain(second),
    };

    const run = runStep(step, { env: { MAIN_CLEAN: 'true' }, gh, prList: withUnarmed(['blocked-by-advisory']) });

    expect(run.status).toBe(0);
    expect(nudged(run)).toEqual(['11']);
  });
});

describe.skipIf(!CAN_RUN)('Dependabot auto-merge approval', () => {
  const step = stepOf(AUTOMERGE, 'automerge', 'arm');
  const reviews = `repos/${REPO}/pulls/42/reviews`;

  /**
   * Runs the arm step for pull request 42 at HEAD_SHA, with its reviews paged.
   * @param pages - The reviews on each page.
   * @returns The step run.
   */
  function arm(pages: readonly unknown[]): IStepRun {
    mkdirSync(join(work, 'runner-temp'), { recursive: true });
    writeFileSync(join(work, 'runner-temp', 'disarm.sh'), 'disarm() { :; }\n');
    const gh = {
      user: { login: 'owner' },
      [`repos/${REPO}/pulls/42`]: { head: { sha: HEAD_SHA } },
      [reviews]: { fakePages: pages },
    };
    const env = { PR_NUMBER: '42', HEAD_SHA, DECISION_REASON: 'patch', GITHUB_STEP_SUMMARY: join(work, 'summary') };
    return runStep(step, { env, gh });
  }

  /**
   * Counts the approvals a run posted.
   * @param run - The step run.
   * @returns How many approvals it posted.
   */
  function approvals(run: IStepRun): number {
    return run.ghCalls.filter((call) => call.startsWith(`api -X POST ${reviews}`)).length;
  }

  it.each([
    ['approves a head it has not approved', [[]], 1],
    [
      'finds its approval of the head on a later page',
      [[{ user: { login: 'other' } }], [{ user: { login: 'owner' }, state: 'APPROVED', commit_id: HEAD_SHA }]],
      0,
    ],
  ])('%s, then arms auto-merge', (_case, pages, posted) => {
    const run = arm(pages);

    expect(run.status).toBe(0);
    expect(approvals(run)).toBe(posted);
    expect(run.ghCalls.filter((call) => call.startsWith('pr merge 42 '))).toHaveLength(1);
  });

  it('stops before approving when a page of reviews is not a list', () => {
    const run = arm([[], null]);

    expect(run.status).not.toBe(0);
    expect(approvals(run)).toBe(0);
    expect(run.ghCalls.filter((call) => call.startsWith('pr merge '))).toEqual([]);
  });
});

describe.skipIf(!CAN_RUN)('npm pin for lockfile writers', () => {
  const action = parse(readFileSync(join(ROOT, PIN_NPM, 'action.yml'), 'utf8')) as { runs: { steps: IStep[] } };
  const step = action.runs.steps.find((candidate) => candidate.id === 'pin') ?? {};

  /**
   * Runs the pin step against a Dockerfile.
   * @param dockerfile - Dockerfile contents.
   * @param npmVersion - What `npm --version` reports; defaults to the installed version.
   * @returns The run and every npm call it made.
   */
  function pin(dockerfile: string, npmVersion = ''): { run: IStepRun; npmCalls: string[] } {
    writeFileSync(join(work, 'Dockerfile'), dockerfile);
    const run = runStep(step, { env: { FAKE_NPM_VERSION: npmVersion } });
    const log = join(work, 'npm-calls.log');
    return { run, npmCalls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [] };
  }

  it('installs the exact npm the Dockerfile pins', () => {
    const { run, npmCalls } = pin('FROM node:26-slim\nARG NPM_VERSION=12.2.1\n');

    expect(run.status).toBe(0);
    expect(npmCalls).toEqual(['install -g npm@12.2.1 --ignore-scripts', '--version']);
  });

  it('pins the version the repository Dockerfile names', () => {
    const { run, npmCalls } = pin(readFileSync(join(ROOT, 'Dockerfile'), 'utf8'));

    expect(run.status).toBe(0);
    expect(npmCalls[0]).toMatch(/^install -g npm@\d+\.\d+\.\d+ --ignore-scripts$/);
  });

  it('fails when npm still reports another version after the install', () => {
    const { run } = pin('ARG NPM_VERSION=12.2.1\n', '11.21.1');

    expect(run.status).not.toBe(0);
  });

  it.each([
    ['names no npm version', 'FROM node:26-slim\n'],
    ['names a range', 'ARG NPM_VERSION=^12\n'],
    ['quotes the version', 'ARG NPM_VERSION="12.2.1"\n'],
    ['names two versions', 'ARG NPM_VERSION=12.2.1\nARG NPM_VERSION=12.3.0\n'],
  ])('installs nothing when the Dockerfile %s', (_case, dockerfile) => {
    const { run, npmCalls } = pin(dockerfile);

    expect(run.status).not.toBe(0);
    expect(npmCalls).toEqual([]);
  });

  it('lockfile-sync pins npm before its first npm command', () => {
    const steps = jobsOf(SYNC).sync?.steps ?? [];
    const pinAt = steps.findIndex(usesPinNpm);

    expect(pinAt).toBeGreaterThanOrEqual(0);
    expect(pinAt).toBeLessThan(steps.findIndex((s) => /^\s*npm\s/m.test(s.run ?? '')));
  });

  it('pins npm only in jobs that can read no secret', () => {
    const pinned = pinnedJobs(join(ROOT, '.github/workflows'));

    expect(pinned.map(({ job }) => job)).toContain('lockfile-sync.yml:sync');
    expect(pinned.filter(({ readsSecret }) => readsSecret)).toEqual([]);
  });

  it.each([
    ['a secret by property', 'a.yml', `./${PIN_NPM}`, { env: { T: '${{ secrets.TOKEN }}' } }],
    ['a secret by index', 'b.yaml', `./${PIN_NPM}/`, { env: { T: "${{ secrets['TOKEN'] }}" } }],
    ['a secret through a remote ref', 'c.yml', `${REPO}/${PIN_NPM}@main`, { env: { T: '${{ secrets.TOKEN }}' } }],
    ['the whole secrets context', 'd.yml', './.github/actions/ci/./pin-npm', { env: { T: '${{ toJSON(secrets) }}' } }],
    ['a secret in upper case', 'e.yml', './.github/actions/x/../ci/pin-npm', { env: { T: '${{ SECRETS.TOKEN }}' } }],
    ['the GitHub token', 'f.yml', `./${PIN_NPM}`, { env: { T: '${{ github.token }}' } }],
    ['the whole github context', 'g.yml', `./${PIN_NPM}`, { env: { T: '${{ toJSON(github) }}' } }],
    ['the GitHub token in a bare condition', 'h.yml', `./${PIN_NPM}`, { if: "github['token'] != ''" }],
  ])('notices a pinned job that reads %s', (_case, file, uses, read) => {
    const steps = [{ uses }, { run: 'echo', ...read }];
    writeFileSync(join(work, file), stringify({ on: 'push', jobs: { j: { 'runs-on': 'ubuntu-latest', steps } } }));

    expect(pinnedJobs(work)).toEqual([{ job: `${file}:j`, readsSecret: true }]);
  });

  it('runs the npm pin from no other action, which the job check cannot see into', () => {
    expect(actionFiles(ROOT)).toContain(`${PIN_NPM}/action.yml`);
    expect(nestedPins(ROOT)).toEqual([]);
  });

  it('notices an action outside .github that runs the npm pin', () => {
    spawnSync('git', ['init', '-q'], { cwd: work });
    mkdirSync(join(work, 'ci/wrapper'), { recursive: true });
    const wrapper = { runs: { using: 'composite', steps: [{ uses: `./${PIN_NPM}` }] } };
    writeFileSync(join(work, 'ci/wrapper/action.yaml'), stringify(wrapper));

    expect(nestedPins(work)).toEqual(['ci/wrapper/action.yaml']);
  });

  it('installs no package in the job that later holds RELEASE_TOKEN', () => {
    const steps = jobsOf(REFRESH).refresh?.steps ?? [];

    expect(JSON.stringify(steps)).toContain('secrets.RELEASE_TOKEN');
    expect(steps.filter(usesPinNpm)).toEqual([]);
    expect(steps.filter((s) => /\b(npm (install|i|ci|exec)|npx)\b/.test(s.run ?? ''))).toEqual([]);
  });

  it('refuses a branch-supplied .npmrc before it installs npm', () => {
    const steps = jobsOf(SYNC).sync?.steps ?? [];
    const refuseAt = steps.findIndex((s) => s.name === 'Refuse a branch-supplied npm config');

    expect(refuseAt).toBeGreaterThanOrEqual(0);
    expect(refuseAt).toBeLessThan(steps.findIndex(usesPinNpm));
  });
});
