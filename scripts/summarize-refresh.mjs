#!/usr/bin/env node
/**
 * Reports what a lockfile refresh changed, for the refresh workflow to act on.
 *
 * `.github/workflows/lockfile-refresh.yml` needs four answers before it can
 * commit a regenerated lockfile: whether anything moved, which Conventional
 * Commit type the change demands, which pins crossed a major version (and so
 * must not auto-merge), and what to tell the reviewer. Deriving them
 * here rather than in workflow YAML keeps the rule unit-tested — see
 * tests/refresh-lockfile-logic.test.ts — instead of encoded in shell that
 * nothing exercises until the night it runs.
 *
 * Usage:
 *   node scripts/summarize-refresh.mjs <before-lockfile> <after-lockfile>
 *     [--floors <plan.json>] [--prune <prune.json>]
 *
 * `--floors` takes the plan `plan-override-floors.mjs --apply` printed and
 * `--prune` the result of its `--prune` mode; both are optional, and either
 * one that changed `overrides` turns the refresh into `fix(deps)`.
 *
 * Prints one JSON object to stdout:
 *   { hasChanges, commitType, title, majorBumps, overridesChanged, body }.
 * JSON rather than GitHub's `name=value` format, so the script stays useful —
 * and runnable by hand — outside Actions.
 */

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import {
  applyOverrideChanges,
  findMajorBumps,
  formatRefreshBody,
  summarizeRefresh,
} from './refresh-lockfile-logic.mjs';

const USAGE = 'Usage: node scripts/summarize-refresh.mjs <before> <after> [--floors <plan.json>] [--prune <prune.json>]';

/**
 * Stops the run with a message on stderr.
 *
 * @param {string} message What went wrong.
 * @returns {never} Never returns.
 */
function fail(message) {
  console.error(message);
  process.exit(1);
}

/**
 * Reads one input file, refusing to summarise a file it could not read.
 *
 * A missing file here would otherwise surface as an empty diff, which reads
 * exactly like "nothing changed" — the one answer that must never be guessed.
 *
 * @param {string | undefined} path Filesystem path to the file.
 * @returns {string} The file contents.
 */
function readInput(path) {
  if (path === undefined) fail(USAGE);
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    return fail(`Unable to read ${path}: ${error.message}`);
  }
}

/**
 * Reads an optional JSON result and checks the lists it must carry, so a
 * truncated plan cannot read as "no floors".
 *
 * @param {string | undefined} path The file, when the flag was given.
 * @param {readonly string[]} lists The array fields it must hold.
 * @returns {Record<string, unknown[]>} The parsed result, or `{}` when absent.
 */
function readResult(path, lists) {
  if (path === undefined) return {};
  let parsed;
  try {
    parsed = JSON.parse(readInput(path));
  } catch (error) {
    return fail(`${path} is not valid JSON: ${error.message}`);
  }
  const missing = lists.filter((list) => !Array.isArray(parsed?.[list]));
  if (missing.length > 0) fail(`${path} lacks the ${missing.join(', ')} list(s).`);
  return parsed;
}

/**
 * Parses the command line.
 *
 * @returns {{ positionals: string[], values: { floors?: string, prune?: string } }} The parsed arguments.
 */
function parseCommandLine() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: { floors: { type: 'string' }, prune: { type: 'string' } },
      strict: true,
    });
  } catch (error) {
    return fail(`${error.message}\n${USAGE}`);
  }
}

const { positionals, values } = parseCommandLine();
const beforeText = readInput(positionals[0]);
const afterText = readInput(positionals[1]);
const plan = readResult(values.floors, ['floors', 'rejections']);
const pruneResult = readResult(values.prune, ['pruned']);
const summary = applyOverrideChanges(summarizeRefresh(beforeText, afterText), {
  floors: plan.floors,
  rejections: plan.rejections,
  pruned: pruneResult.pruned,
});
const majorBumps = findMajorBumps(beforeText, afterText);

process.stdout.write(
  `${JSON.stringify({
    hasChanges: summary.hasChanges,
    commitType: summary.commitType,
    title: summary.title,
    majorBumps,
    overridesChanged: summary.overridesChanged,
    body: formatRefreshBody({ ...summary, majorBumps }),
  })}\n`,
);
