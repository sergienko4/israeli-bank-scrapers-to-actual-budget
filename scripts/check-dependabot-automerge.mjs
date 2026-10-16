#!/usr/bin/env node
/**
 * Dependabot auto-merge decision step.
 *
 * Prints the auto-merge verdict for one Dependabot pull request as JSON and,
 * inside GitHub Actions, writes `action` and `reason` step outputs. See
 * scripts/dependabot-automerge-logic.mjs for the policy and its rationale.
 *
 * Usage:
 *   node scripts/check-dependabot-automerge.mjs \
 *     --message-file <path> --repinned <true|false> --ecosystem <name>
 *
 * `--message-file` holds the first Dependabot-authored commit message.
 * Any failure — an unreadable file, a missing flag, an unexpected error —
 * still emits a `skip` verdict and exits non-zero, so the workflow never
 * merges on a broken decision.
 */

import { appendFileSync, readFileSync } from 'node:fs';

import { AUTO_MERGE_ACTIONS, decide, toGithubOutput } from './dependabot-automerge-logic.mjs';

/**
 * Reads a named `--flag value` argument from the process arguments.
 *
 * @param {string} flag The flag to read, including its leading dashes.
 * @returns {string | undefined} The value that follows the flag, if present.
 */
function readFlag(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * Parses the `--repinned` flag strictly.
 *
 * Only the literal strings `true` and `false` are accepted; anything else
 * becomes `undefined`, which the policy treats as "unknown" and skips.
 *
 * @param {string | undefined} value The raw flag value.
 * @returns {boolean | undefined} The parsed flag, or undefined when invalid.
 */
function parseRepinned(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/**
 * Writes a verdict to stdout and, inside Actions, to the step outputs.
 *
 * @param {{ action: string, reason: string }} verdict The verdict to emit.
 * @returns {void}
 */
function emit(verdict) {
  console.log(JSON.stringify(verdict, null, 2));
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) appendFileSync(outputFile, toGithubOutput(verdict));
}

/**
 * Computes the verdict from the command-line flags.
 *
 * @returns {{ action: string, reason: string }} The policy verdict.
 */
function run() {
  const messageFile = readFlag('--message-file');
  if (!messageFile) throw new Error('--message-file <path> is required');
  return decide({
    commitMessage: readFileSync(messageFile, 'utf8'),
    repinned: parseRepinned(readFlag('--repinned')),
    ecosystem: readFlag('--ecosystem'),
  });
}

try {
  emit(run());
  process.exit(0);
} catch (error) {
  console.error(`❌ Dependabot auto-merge decision failed: ${error.message}`);
  emit({ action: AUTO_MERGE_ACTIONS.skip, reason: 'decision step failed; failing closed', entries: [] });
  process.exit(1);
}
