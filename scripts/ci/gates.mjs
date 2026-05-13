/**
 * Canonical registry of validation gates for this repository.
 *
 * Every surface that asks "what must pass before code lands?" reads this
 * file: the husky pre-commit hook, the pr.yml workflow, the
 * dependency-check.yml workflow, the release.yml workflow, and the local
 * `npm run validate` script. Adding, removing, or renaming a gate is a
 * one-place change.
 *
 * @see ../../docs/GUIDELINES.md
 * @see ../../.husky/pre-commit
 * @see ../../.github/workflows/pr.yml
 */

/**
 * @typedef {'local'|'pr'|'dep-bump'|'release'} Scope
 */

/**
 * @typedef {Object} Gate
 * @property {string} id
 *   Kebab-case unique identifier. Used as the matrix key in CI and the
 *   CLI's `--gate=` argument.
 * @property {string} name
 *   Human label printed in logs and CI summary.
 * @property {ReadonlyArray<Scope>} scopes
 *   Which validation surfaces run this gate.
 * @property {ReadonlyArray<string>} run
 *   argv-style command. argv[0] is the executable; remaining elements
 *   are arguments. Never a shell string — avoids quoting bugs.
 * @property {ReadonlyArray<string>=} requires
 *   Gate ids that MUST pass before this gate starts. Forms a DAG; the
 *   runner refuses cycles. Optional; defaults to none (independent).
 * @property {boolean=} needsDocker
 *   When true, the runner verifies the Docker daemon is reachable
 *   before starting this gate. Fail-fast with exit code 3 if not.
 * @property {ReadonlyArray<string>=} needsSecrets
 *   Env var names this gate requires. Runner fails fast with exit code
 *   3 if any are missing.
 */

/**
 * Authoritative gate list. Order is for human readability; execution
 * order is determined by `scopes` + `requires`.
 *
 * @type {ReadonlyArray<Gate>}
 */
export const GATES = Object.freeze([
  {
    id: 'typecheck',
    name: 'Type-check (strict)',
    scopes: ['local', 'pr', 'dep-bump', 'release'],
    run: ['npm', 'run', 'type-check'],
  },
  {
    id: 'audit',
    name: 'npm audit (moderate)',
    scopes: ['local', 'pr', 'dep-bump', 'release'],
    run: ['npm', 'audit', '--audit-level=moderate'],
  },
  {
    id: 'build',
    name: 'TypeScript build',
    scopes: ['local', 'pr', 'dep-bump', 'release'],
    run: ['npm', 'run', 'build'],
  },
  {
    id: 'docs',
    name: 'TypeDoc API docs',
    scopes: ['local', 'pr', 'release'],
    requires: ['build'],
    run: ['npm', 'run', 'docs'],
  },
  {
    id: 'unit',
    name: 'Unit tests + coverage',
    scopes: ['local', 'pr', 'dep-bump', 'release'],
    requires: ['build'],
    run: ['npm', 'run', 'test:unit'],
  },
  {
    id: 'eslint',
    name: 'ESLint',
    scopes: ['local', 'pr', 'release'],
    run: ['npm', 'run', 'lint'],
  },
  {
    id: 'biome',
    name: 'Biome lint',
    scopes: ['local', 'pr', 'release'],
    run: ['npm', 'run', 'lint:biome'],
  },
  {
    id: 'lint-canaries',
    name: 'ESLint canaries',
    scopes: ['local', 'pr', 'release'],
    run: ['npm', 'run', 'lint:canaries'],
  },
  {
    id: 'lint-licenses',
    name: 'License compliance',
    scopes: ['local', 'pr', 'dep-bump', 'release'],
    run: ['npm', 'run', 'lint:licenses'],
  },
  {
    id: 'markdownlint',
    name: 'Markdown lint',
    scopes: ['local', 'pr', 'release'],
    run: ['npm', 'run', 'lint:docs'],
  },
  {
    id: 'config-structure',
    name: 'Config structure check',
    scopes: ['local', 'pr', 'release'],
    run: ['npm', 'run', 'lint:config-structure'],
  },
  {
    id: 'pii',
    name: 'PII interpolation check',
    scopes: ['local', 'pr', 'dep-bump', 'release'],
    run: ['node', 'scripts/ci/checks/pii.mjs'],
  },
  {
    id: 'semgrep',
    name: 'Semgrep SAST',
    scopes: ['local', 'pr', 'release'],
    needsDocker: true,
    run: [
      'docker', 'run', '--rm',
      '-v', `${process.cwd()}:/data`,
      '--workdir', '/data',
      'semgrep/semgrep@sha256:9fb6f44dc162b1e0aada85f072a95141844c61e3bfcedf40b8a46fecf208e986',
      'semgrep', 'scan',
      '--config', 'auto',
      '--config', '.semgrep/',
      '--error',
      'src/',
    ],
  },
  {
    id: 'lychee',
    name: 'Markdown link check',
    scopes: ['local', 'pr', 'release'],
    needsDocker: true,
    run: [
      'docker', 'run', '--rm',
      '-v', `${process.cwd()}:/data`,
      '--workdir', '/data',
      '-e', `GITHUB_TOKEN=${process.env.GITHUB_TOKEN ?? ''}`,
      'lycheeverse/lychee@sha256:609d1bea17f053bee6df907017e4eb8a0163e90633a26fce3ce8aaba1a3df443',
      '--exclude-path', 'config/lychee/ignore',
      '--exclude-path', 'CHANGELOG.md',
      '--no-progress',
      '*.md', 'docs/**/*.md', '.github/**/*.md',
    ],
  },
  {
    id: 'docker-image',
    name: 'Docker build + browser smoke',
    scopes: ['local', 'pr', 'dep-bump', 'release'],
    needsDocker: true,
    run: ['node', 'scripts/ci/checks/docker-image.mjs'],
  },
  {
    id: 'trivy',
    name: 'Trivy container scan',
    scopes: ['local', 'pr', 'release'],
    requires: ['docker-image'],
    needsDocker: true,
    run: ['node', 'scripts/ci/checks/trivy.mjs'],
  },
  {
    id: 'e2e-mock',
    name: 'E2E (mocked)',
    scopes: ['local', 'pr', 'dep-bump', 'release'],
    requires: ['build'],
    run: ['npm', 'run', 'test:e2e:mock'],
  },
  {
    id: 'e2e-telegram',
    name: 'E2E with Telegram delivery',
    scopes: ['local', 'release'],
    requires: ['build'],
    needsSecrets: ['E2E_TELEGRAM_BOT_TOKEN', 'E2E_TELEGRAM_CHAT_ID'],
    run: ['npm', 'run', 'test:e2e'],
  },
]);

/**
 * Returns the gates that run in a given scope, ordered by dependency.
 * Independent gates appear first; dependents after their requirements.
 *
 * @param {Scope} scope
 * @returns {ReadonlyArray<Gate>}
 */
export function gatesForScope(scope) {
  const selected = GATES.filter((gate) => gate.scopes.includes(scope));
  return topoSort(selected);
}

/**
 * Looks up a gate by id. Throws if not found.
 *
 * @param {string} id
 * @returns {Gate}
 */
export function gateById(id) {
  const gate = GATES.find((g) => g.id === id);
  if (gate === undefined) {
    throw new Error(`Unknown gate id: "${id}". Known: ${GATES.map((g) => g.id).join(', ')}`);
  }
  return gate;
}

/**
 * Returns the set of all gate ids transitively required by `gate`.
 *
 * @param {Gate} gate
 * @returns {Set<string>}
 */
export function transitiveRequires(gate) {
  const seen = new Set();
  const stack = [...(gate.requires ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const dep = GATES.find((g) => g.id === id);
    if (dep === undefined) {
      throw new Error(`Gate "${gate.id}" requires unknown gate "${id}"`);
    }
    for (const req of dep.requires ?? []) stack.push(req);
  }
  return seen;
}

/**
 * Topological sort of gates by `requires`. Throws on cycle or missing dep.
 *
 * @param {ReadonlyArray<Gate>} gates
 * @returns {ReadonlyArray<Gate>}
 */
function topoSort(gates) {
  const byId = new Map(gates.map((g) => [g.id, g]));
  const visited = new Set();
  const visiting = new Set();
  const out = [];
  /** @param {Gate} g */
  const visit = (g) => {
    if (visited.has(g.id)) return;
    if (visiting.has(g.id)) {
      throw new Error(`Cycle detected at gate "${g.id}"`);
    }
    visiting.add(g.id);
    for (const reqId of g.requires ?? []) {
      const dep = byId.get(reqId);
      if (dep === undefined) {
        throw new Error(`Gate "${g.id}" requires "${reqId}" which is not in the selected scope`);
      }
      visit(dep);
    }
    visiting.delete(g.id);
    visited.add(g.id);
    out.push(g);
  };
  for (const g of gates) visit(g);
  return out;
}
