/**
 * Keeps the git hooks and CI in step.
 *
 * The inventory below names every gate a hook runs, the stage that runs it,
 * and the script CI must run so a commit made without hooks is still
 * checked. The test reads the hooks, package.json and the PR workflow as
 * written and fails when any of them drifts from the inventory: a hook gate
 * the inventory does not know, an inventory gate a hook no longer runs, a
 * gate CI no longer runs, or a gate a hook starts but never waits on.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WORKFLOW = '.github/workflows/pr.yml';

/** A hook that runs gates through config/hooks/gate-runner.sh. */
type HookStage = 'pre-commit' | 'pre-push';

/** One gate: the npm script, the hooks that run it, the script CI runs. */
interface IGateRow {
  readonly script: string;
  readonly stages: readonly HookStage[];
  readonly ciScript: string;
}

/** A `run_gate` line parsed from a hook. */
interface IHookGate {
  readonly id: string;
  readonly command: string;
}

/** The slice of a workflow file this test reads. */
interface IWorkflow {
  readonly jobs: Record<string, { readonly steps?: readonly { readonly run?: string }[] }>;
}

const HOOK_STAGES: readonly HookStage[] = ['pre-commit', 'pre-push'];

const INVENTORY: readonly IGateRow[] = [
  { script: 'type-check', stages: ['pre-commit'], ciScript: 'type-check' },
  { script: 'lint:cached', stages: ['pre-commit'], ciScript: 'lint' },
  { script: 'lint:biome', stages: ['pre-commit'], ciScript: 'lint:biome' },
  { script: 'lint:config-structure', stages: ['pre-commit'], ciScript: 'lint:config-structure' },
  { script: 'lint:allow-scripts', stages: ['pre-commit'], ciScript: 'lint:allow-scripts' },
  { script: 'lint:pii', stages: ['pre-commit'], ciScript: 'lint:pii' },
  { script: 'type-check:test', stages: ['pre-push'], ciScript: 'type-check:test' },
  { script: 'type-check:e2e', stages: ['pre-push'], ciScript: 'type-check:test' },
  { script: 'audit', stages: ['pre-push'], ciScript: 'audit' },
  { script: 'build', stages: ['pre-push'], ciScript: 'build' },
  { script: 'docs', stages: ['pre-push'], ciScript: 'docs' },
  { script: 'lint', stages: ['pre-push'], ciScript: 'lint' },
  { script: 'lint:docs', stages: ['pre-push'], ciScript: 'lint:docs' },
  { script: 'lint:circular', stages: ['pre-push'], ciScript: 'lint:circular' },
  { script: 'coupling:check', stages: ['pre-push'], ciScript: 'coupling:check' },
  { script: 'test:unit', stages: [], ciScript: 'test:unit' },
  { script: 'lint:canaries', stages: [], ciScript: 'lint:canaries' },
  { script: 'lint:lockfile', stages: [], ciScript: 'lint:lockfile' },
  { script: 'lint:manifest', stages: [], ciScript: 'lint:manifest' },
];

const NPM_RUN = /npm run (?:-s )?([\w:.-]+)/g;

/**
 * Reads a repository file as text.
 * @param relPath - Path relative to the repository root.
 * @returns File content.
 */
const readRepoFile = (relPath: string): string => readFileSync(join(ROOT, relPath), 'utf8');

/**
 * Lists the npm scripts named by `npm run` in a shell snippet.
 * @param text - Shell text.
 * @returns Script names in order of appearance.
 */
const npmRunTargets = (text: string): string[] => [...text.matchAll(NPM_RUN)].map((m) => m[1]);

/**
 * Parses every `run_gate <id> <label> <command>` line of a hook.
 * @param hookText - Hook source.
 * @returns The gates in source order.
 */
function parseRunGates(hookText: string): IHookGate[] {
  const lines = hookText.matchAll(/^run_gate\s+"([^"]+)"\s+"[^"]*"\s+(.+)$/gm);
  return [...lines].map((m) => ({ id: m[1], command: m[2].trim() }));
}

/**
 * Parses the gate ids passed to `wait_gates`, across line continuations.
 * @param hookText - Hook source.
 * @returns The waited gate ids.
 */
function parseWaitedIds(hookText: string): string[] {
  const call = /^wait_gates((?:[^\n]*\\\n)*[^\n]*)$/m.exec(hookText);
  return call ? [...call[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
}

/**
 * Returns the npm script a gate command runs, or undefined for any other
 * command shape (inline shell, npx, extra arguments).
 * @param command - The command part of a `run_gate` line.
 * @returns The script name, if the command is exactly `npm run <script>`.
 */
const gateScript = (command: string): string | undefined =>
  /^npm run ([\w:.-]+)$/.exec(command)?.[1];

/**
 * Expands scripts through the `npm run` calls their package.json bodies
 * make, so a gate reached through a chain such as validate:ci counts.
 * @param roots - Scripts CI calls directly.
 * @param scripts - package.json scripts.
 * @returns Every script CI reaches.
 */
function expandScripts(roots: readonly string[], scripts: Record<string, string>): Set<string> {
  const reached = new Set<string>();
  const queue = [...roots];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    if (reached.has(name)) continue;
    reached.add(name);
    queue.push(...npmRunTargets(scripts[name] ?? ''));
  }
  return reached;
}

/**
 * Lists the scripts the PR workflow runs, directly or through chains.
 * @param scripts - package.json scripts.
 * @returns Every script reached from a workflow `run:` step.
 */
function ciScripts(scripts: Record<string, string>): Set<string> {
  const workflow = parse(readRepoFile(WORKFLOW)) as IWorkflow;
  const runs = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
  const roots = runs.flatMap((step) => npmRunTargets(step.run ?? ''));
  return expandScripts(roots, scripts);
}

/**
 * Resolves a tsconfig the way tsc does.
 * @param relPath - tsconfig path relative to the repository root.
 * @returns The parsed command line.
 */
function resolveTsconfig(relPath: string): ts.ParsedCommandLine {
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diag) => {
      throw new Error(ts.flattenDiagnosticMessageText(diag.messageText, '\n'));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(join(ROOT, relPath), {}, host);
  if (!parsed) throw new Error(`cannot parse ${relPath}`);
  return parsed;
}

const PACKAGE_SCRIPTS = (JSON.parse(readRepoFile('package.json')) as { scripts: Record<string, string> })
  .scripts;

describe.each(HOOK_STAGES)('.husky/%s', (stage) => {
  const hookText = readRepoFile(`.husky/${stage}`);
  const gates = parseRunGates(hookText);
  const expected = INVENTORY.filter((row) => row.stages.includes(stage)).map((row) => row.script);

  it('runs at least one gate', () => {
    expect(gates.length).toBeGreaterThan(0);
  });

  it('runs only `npm run <script>` gates the inventory assigns to this stage', () => {
    const unknown = gates.filter((gate) => !expected.includes(gateScript(gate.command) ?? ''));
    expect(unknown).toEqual([]);
  });

  it('runs every gate the inventory assigns to this stage', () => {
    const run = gates.map((gate) => gateScript(gate.command));
    expect(expected.filter((script) => !run.includes(script))).toEqual([]);
  });

  it('waits on exactly the gates it starts', () => {
    expect(parseWaitedIds(hookText).sort()).toEqual(gates.map((gate) => gate.id).sort());
  });
});

describe('CI coverage of the gate inventory', () => {
  it('names only scripts that exist in package.json', () => {
    const names = INVENTORY.flatMap((row) => [row.script, row.ciScript]);
    expect(names.filter((name) => !(name in PACKAGE_SCRIPTS))).toEqual([]);
  });

  it(`runs every gate's CI script from ${WORKFLOW}`, () => {
    const reached = ciScripts(PACKAGE_SCRIPTS);
    const missing = INVENTORY.filter((row) => !reached.has(row.ciScript));
    expect(missing).toEqual([]);
  });
});

describe('tsconfig.e2e.json stays covered by type-check:test', () => {
  const e2e = resolveTsconfig('tsconfig.e2e.json');
  const test = resolveTsconfig('tsconfig.test.json');

  it('type-checks no file that tsconfig.test.json leaves out', () => {
    expect(e2e.fileNames.length).toBeGreaterThan(0);
    const covered = new Set(test.fileNames);
    expect(e2e.fileNames.filter((file) => !covered.has(file))).toEqual([]);
  });

  it('uses the same compiler options as tsconfig.test.json', () => {
    const { configFilePath: _e2ePath, ...e2eOptions } = e2e.options;
    const { configFilePath: _testPath, ...testOptions } = test.options;
    expect(e2eOptions).toEqual(testOptions);
  });
});
