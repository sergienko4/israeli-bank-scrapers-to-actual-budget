import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * A single step of the reconcile job, narrowed to the fields these tests assert on.
 */
interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}

/**
 * The parsed reconcile workflow, narrowed to the shape these tests assert on.
 */
interface Workflow {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs?: Record<string, { steps?: WorkflowStep[] }>;
}

const WORKFLOW_URL = new URL('../.github/workflows/lockfile-reconcile.yml', import.meta.url);

/**
 * Parses the reconcile workflow.
 *
 * The path is resolved relative to this file so the suite does not depend on the
 * working directory vitest happens to be launched from.
 *
 * @returns the parsed workflow document
 */
function loadWorkflow(): Workflow {
  return parse(readFileSync(WORKFLOW_URL, 'utf8')) as Workflow;
}

/**
 * Collects every step of the workflow's single job.
 *
 * @returns the ordered step list
 */
function steps(): WorkflowStep[] {
  const jobs = loadWorkflow().jobs ?? {};
  return Object.values(jobs).flatMap((job) => job.steps ?? []);
}

/**
 * Finds the index of the first step whose `run` script matches a predicate.
 *
 * @param matches predicate applied to each step's run script
 * @returns the zero-based index, or -1 when no step matches
 */
function indexOfRun(matches: (script: string) => boolean): number {
  return steps().findIndex((step) => typeof step.run === 'string' && matches(step.run));
}

/**
 * Collects every `run` script in the workflow.
 *
 * @returns each step's run script, in order
 */
function runScripts(): string[] {
  return steps()
    .map((step) => step.run)
    .filter((run): run is string => typeof run === 'string');
}

describe('lockfile-reconcile workflow', () => {
  it('runs only when a human dispatches it', () => {
    const triggers = loadWorkflow().on ?? {};

    expect(Object.keys(triggers)).toEqual(['workflow_dispatch']);
  });

  it('takes the branch to reconcile as an input', () => {
    const dispatch = loadWorkflow().on?.workflow_dispatch as
      | { inputs?: Record<string, unknown> }
      | undefined;

    expect(dispatch?.inputs).toHaveProperty('ref');
  });

  it('checks out the requested ref instead of a hard-coded branch', () => {
    const checkout = steps().find((step) => step.uses?.startsWith('actions/checkout'));

    expect(String(checkout?.with?.ref)).toContain('inputs.ref');
  });

  it('checks out without leaving credentials in the git config', () => {
    const checkout = steps().find((step) => step.uses?.startsWith('actions/checkout'));

    expect(checkout?.with?.['persist-credentials']).toBe(false);
  });

  it('reconciles the lockfile to the committed package.json', () => {
    const regen = runScripts().find((script) => script.includes('npm install'));

    expect(regen).toContain('--package-lock-only');
  });

  it('never runs an install that could execute third-party code', () => {
    const installs = runScripts().filter(
      (script) => script.includes('npm install') || script.includes('npm ci'),
    );

    expect(installs.length).toBeGreaterThan(0);
    for (const script of installs) {
      expect(script).toContain('--package-lock-only');
      expect(script).toContain('--ignore-scripts');
    }
  });

  it('refuses to proceed when anything other than the lockfile changed', () => {
    const guard = runScripts().find((script) => script.includes('git diff --name-only'));

    expect(guard).toContain('package-lock.json');
    expect(guard).toContain('exit 1');
  });

  it('verifies the regenerated lockfile is canonical before pushing it', () => {
    const canonical = indexOfRun((script) => script.includes('refresh-lockfile.mjs --check'));
    const push = indexOfRun((script) => script.includes('git push'));

    expect(canonical).toBeGreaterThanOrEqual(0);
    expect(push).toBeGreaterThan(canonical);
  });

  it('stages the lockfile by name rather than staging every change', () => {
    const commit = runScripts().find((script) => script.includes('git add'));

    expect(commit).toContain('git add package-lock.json');
    expect(commit).not.toMatch(/git add\s+(-A|--all|\.)\s/);
  });

  it('refuses to write to the default branch', () => {
    const guard = steps().find((step) =>
      Object.values(step.env ?? {}).some((value) => value.includes('default_branch')),
    );

    expect(guard?.run).toContain('exit 1');
  });

  it('never interpolates a workflow expression directly into a shell script', () => {
    for (const script of runScripts()) {
      expect(script).not.toMatch(/\$\{\{/);
    }
  });

  it('leaves the workflow token read-only because the push uses a PAT', () => {
    expect(loadWorkflow().permissions?.contents).toBe('read');
  });

  it('confines the push token to the single step that pushes', () => {
    const withToken = steps().filter((step) =>
      Object.values(step.env ?? {}).some((value) => value.includes('RELEASE_TOKEN')),
    );

    expect(withToken).toHaveLength(1);
    expect(withToken[0]?.run).toContain('git push');
  });

  // Declaring the token in `env` proves nothing on its own: `persist-credentials`
  // is false, so a bare `git push` would have no credentials at all and would
  // fail on the runner while this suite stayed green. Assert the token is
  // actually spent on the remote URL, and that the push targets the same branch
  // the job checked out.
  it('authenticates the push with the token and targets the checked-out ref', () => {
    const push = runScripts().find((script) => script.includes('git push'));

    expect(push).toContain('x-access-token:${GH_TOKEN}');
    expect(push).toContain('HEAD:refs/heads/${REF}');
  });
});
