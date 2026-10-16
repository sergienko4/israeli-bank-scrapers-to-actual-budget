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
 * Any failure — an unreadable file, a missing flag, an unwritable
 * `GITHUB_OUTPUT`, an unexpected error — still prints a `skip` verdict and
 * exits non-zero, so the workflow never merges on a broken decision.
 *
 * The step outputs are written before the verdict is printed. When that
 * write fails, stdout therefore never carries a `merge` verdict the
 * workflow did not actually record.
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

/** The verdict recorded whenever the decision cannot be trusted. */
const FAIL_CLOSED_VERDICT = Object.freeze({
  action: AUTO_MERGE_ACTIONS.skip,
  reason: 'decision step failed; failing closed',
  entries: [],
});

/**
 * Appends a verdict to the Actions step outputs when running inside Actions.
 *
 * @param {{ action: string, reason: string }} verdict The verdict to record.
 * @returns {void}
 * @throws {Error} When the `GITHUB_OUTPUT` file cannot be written.
 */
function writeStepOutputs(verdict) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) appendFileSync(outputFile, toGithubOutput(verdict));
}

/**
 * Records a verdict in the step outputs first, then prints it to stdout.
 *
 * @param {{ action: string, reason: string }} verdict The verdict to emit.
 * @returns {void}
 * @throws {Error} When the step outputs cannot be written.
 */
function emit(verdict) {
  writeStepOutputs(verdict);
  console.log(JSON.stringify(verdict, null, 2));
}

/**
 * Reports a failed decision, records a `skip` verdict and exits non-zero.
 *
 * A second write failure is logged rather than thrown, so the step always
 * ends with the `skip` verdict on stdout and exit code 1.
 *
 * @param {unknown} error The error that broke the decision.
 * @returns {never} Never returns; the process exits.
 */
function failClosed(error) {
  console.error(`❌ Dependabot auto-merge decision failed: ${errorText(error)}`);
  try {
    writeStepOutputs(FAIL_CLOSED_VERDICT);
  } catch (writeError) {
    console.error(`❌ Unable to write step outputs: ${errorText(writeError)}`);
  }
  console.log(JSON.stringify(FAIL_CLOSED_VERDICT, null, 2));
  process.exit(1);
}

/**
 * Renders any thrown value as a one-line message.
 *
 * @param {unknown} error The thrown value.
 * @returns {string} The error message, or the value as a string.
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
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
  failClosed(error);
}
