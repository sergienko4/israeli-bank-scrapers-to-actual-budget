#!/usr/bin/env node
/**
 * CLI runner for the canonical gate registry.
 *
 * Usage:
 *   node scripts/ci/run-gates.mjs --scope=<local|pr|dep-bump|release> [opts]
 *
 * Options:
 *   --gate=<id>   Run only this gate (still honors its `requires` DAG).
 *   --parallel    Run independent gates concurrently (default: serial).
 *   --list        Print the gates for the scope and exit 0.
 *   --dry-run     Print the commands that would run; do not execute.
 *
 * Exit codes (per spec.txt §SP6):
 *   0  all selected gates passed
 *   1  one or more gates failed
 *   2  CLI usage error
 *   3  prerequisite missing (Docker, secrets, etc.)
 *
 * @see ./gates.mjs
 */

import { spawn } from 'node:child_process';
import process from 'node:process';

import { GATES, gateById, gatesForScope, transitiveRequires } from './gates.mjs';

const SCOPES = new Set(['local', 'pr', 'dep-bump', 'release']);

/**
 * Parses `--key=value` argv into a typed options bag.
 *
 * @param {ReadonlyArray<string>} argv
 * @returns {{scope?: string, gate?: string, parallel: boolean, list: boolean, dryRun: boolean}}
 */
function parseArgv(argv) {
  /** @type {{scope?: string, gate?: string, parallel: boolean, list: boolean, dryRun: boolean}} */
  const out = { parallel: false, list: false, dryRun: false };
  for (const arg of argv) {
    if (arg.startsWith('--scope=')) out.scope = arg.slice('--scope='.length);
    else if (arg.startsWith('--gate=')) out.gate = arg.slice('--gate='.length);
    else if (arg === '--parallel') out.parallel = true;
    else if (arg === '--list') out.list = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else exitUsage(`unknown argument: ${arg}`);
  }
  return out;
}

/**
 * Prints usage hint to stderr and exits with code 2.
 *
 * @param {string} message
 * @returns {never}
 */
function exitUsage(message) {
  process.stderr.write(`run-gates: ${message}\n`);
  process.stderr.write('Usage: node scripts/ci/run-gates.mjs --scope=<local|pr|dep-bump|release> [--gate=<id>] [--parallel] [--list] [--dry-run]\n');
  process.exit(2);
}

/**
 * Checks gate prerequisites (Docker daemon, env-var secrets). Exits 3 if missing.
 *
 * @param {ReadonlyArray<import('./gates.mjs').Gate>} gates
 */
async function checkPrereqs(gates) {
  const needsDocker = gates.some((g) => g.needsDocker === true);
  if (needsDocker) {
    const ok = await dockerAvailable();
    if (!ok) {
      process.stderr.write('run-gates: Docker daemon not reachable. Start Docker Desktop and retry.\n');
      process.exit(3);
    }
  }
  const missing = [];
  for (const gate of gates) {
    for (const name of gate.needsSecrets ?? []) {
      if (process.env[name] === undefined || process.env[name] === '') {
        missing.push(`${gate.id}: $${name}`);
      }
    }
  }
  if (missing.length > 0) {
    process.stderr.write(`run-gates: missing required environment variables:\n  ${missing.join('\n  ')}\n`);
    process.exit(3);
  }
}

/**
 * Probes for a reachable Docker daemon via `docker version`.
 *
 * @returns {Promise<boolean>}
 */
async function dockerAvailable() {
  return await new Promise((resolve) => {
    const child = spawn('docker', ['version', '--format', '{{.Server.Version}}'], {
      stdio: 'ignore',
      shell: false,
    });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
}

/**
 * Executes one gate's command. Resolves with the exit code (never rejects).
 *
 * @param {import('./gates.mjs').Gate} gate
 * @returns {Promise<{id: string, code: number, durationMs: number}>}
 */
async function runGate(gate) {
  const start = Date.now();
  const [cmd, ...args] = gate.run;
  return await new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: false });
    child.once('exit', (code) => {
      resolve({ id: gate.id, code: code ?? 1, durationMs: Date.now() - start });
    });
    child.once('error', (err) => {
      process.stderr.write(`run-gates: failed to spawn "${cmd}": ${err.message}\n`);
      resolve({ id: gate.id, code: 1, durationMs: Date.now() - start });
    });
  });
}

/**
 * Runs gates respecting the `requires` DAG. Serial unless `parallel: true`.
 *
 * @param {ReadonlyArray<import('./gates.mjs').Gate>} gates
 * @param {{parallel: boolean, dryRun: boolean}} opts
 * @returns {Promise<{passed: number, failed: number, totalMs: number}>}
 */
async function runAll(gates, opts) {
  const startedAt = Date.now();
  /** @type {Map<string, {code: number, durationMs: number}>} */
  const results = new Map();
  const remaining = [...gates];

  while (remaining.length > 0) {
    const ready = remaining.filter((g) =>
      (g.requires ?? []).every((id) => results.get(id)?.code === 0)
    );
    if (ready.length === 0) {
      for (const g of remaining) {
        const blocker = (g.requires ?? []).find((id) => results.get(id)?.code !== 0);
        results.set(g.id, { code: 1, durationMs: 0 });
        printLine('[SKIP]', g.id, 0, `dependency "${blocker}" failed`);
      }
      break;
    }

    const batch = opts.parallel ? ready : [ready[0]];
    if (opts.dryRun) {
      for (const g of batch) printLine('[DRY ]', g.id, 0, g.run.join(' '));
      for (const g of batch) results.set(g.id, { code: 0, durationMs: 0 });
    } else {
      const outcomes = await Promise.all(batch.map(runGate));
      for (const r of outcomes) {
        results.set(r.id, { code: r.code, durationMs: r.durationMs });
        printLine(r.code === 0 ? '[PASS]' : '[FAIL]', r.id, r.durationMs);
      }
    }
    for (const g of batch) remaining.splice(remaining.indexOf(g), 1);
  }

  let passed = 0;
  let failed = 0;
  for (const r of results.values()) {
    if (r.code === 0) passed += 1;
    else failed += 1;
  }
  return { passed, failed, totalMs: Date.now() - startedAt };
}

/**
 * Writes one fixed-width status line to stdout.
 *
 * @param {string} tag
 * @param {string} id
 * @param {number} durationMs
 * @param {string=} detail
 */
function printLine(tag, id, durationMs, detail) {
  const ms = durationMs > 0 ? ` (${durationMs}ms)` : '';
  const suffix = detail !== undefined ? ` — ${detail}` : '';
  process.stdout.write(`${tag} ${id.padEnd(20)}${ms}${suffix}\n`);
}

/**
 * Entry point.
 */
async function main() {
  const opts = parseArgv(process.argv.slice(2));
  if (opts.scope === undefined) exitUsage('--scope is required');
  if (!SCOPES.has(opts.scope)) exitUsage(`invalid scope "${opts.scope}"`);

  /** @type {ReadonlyArray<import('./gates.mjs').Gate>} */
  let gates;
  if (opts.gate !== undefined) {
    let target;
    try {
      target = gateById(opts.gate);
    } catch (err) {
      exitUsage(/** @type {Error} */ (err).message);
    }
    const reqIds = transitiveRequires(/** @type {import('./gates.mjs').Gate} */ (target));
    gates = [...GATES.filter((g) => reqIds.has(g.id)), /** @type {import('./gates.mjs').Gate} */ (target)];
  } else {
    gates = gatesForScope(opts.scope);
  }

  if (opts.list) {
    for (const g of gates) process.stdout.write(`${g.id.padEnd(22)} ${g.name}\n`);
    process.exit(0);
  }

  if (!opts.dryRun) await checkPrereqs(gates);

  const { passed, failed, totalMs } = await runAll(gates, opts);
  process.stdout.write(`\nSummary: ${passed}/${passed + failed} passed in ${totalMs}ms\n`);
  process.exit(failed > 0 ? 1 : 0);
}

await main();
