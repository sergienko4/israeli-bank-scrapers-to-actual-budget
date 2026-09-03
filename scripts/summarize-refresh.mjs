#!/usr/bin/env node
/**
 * Reports what a lockfile refresh changed, for the refresh workflow to act on.
 *
 * `.github/workflows/lockfile-refresh.yml` needs three answers before it can
 * commit a regenerated lockfile: whether anything moved, which Conventional
 * Commit type the change demands, and what to tell the reviewer. Deriving them
 * here rather than in workflow YAML keeps the rule unit-tested — see
 * tests/refresh-lockfile-logic.test.ts — instead of encoded in shell that
 * nothing exercises until the night it runs.
 *
 * Usage:
 *   node scripts/summarize-refresh.mjs <before-lockfile> <after-lockfile>
 *
 * Prints one JSON object to stdout: { hasChanges, commitType, title, body }.
 * JSON rather than GitHub's `name=value` format, so the script stays useful —
 * and runnable by hand — outside Actions.
 */

import { readFileSync } from 'node:fs';

import { formatRefreshBody, summarizeRefresh } from './refresh-lockfile-logic.mjs';

/**
 * Reads one lockfile, refusing to summarise a file it could not read.
 *
 * A missing file here would otherwise surface as an empty diff, which reads
 * exactly like "nothing changed" — the one answer that must never be guessed.
 *
 * @param {string | undefined} path Filesystem path to a package-lock.json.
 * @returns {string} The file contents.
 */
function readLockfile(path) {
  if (path === undefined) {
    console.error('Usage: node scripts/summarize-refresh.mjs <before> <after>');
    process.exit(1);
  }
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    console.error(`Unable to read ${path}: ${error.message}`);
    process.exit(1);
  }
}

const [beforePath, afterPath] = process.argv.slice(2);
const summary = summarizeRefresh(readLockfile(beforePath), readLockfile(afterPath));

process.stdout.write(
  `${JSON.stringify({
    hasChanges: summary.hasChanges,
    commitType: summary.commitType,
    title: summary.title,
    body: formatRefreshBody(summary),
  })}\n`,
);
