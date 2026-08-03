#!/usr/bin/env node
/**
 * Release-signal CI guard.
 *
 * Fails a pull request that changes a dependency shipped inside the published
 * Docker image while carrying a title release-please will not release on. See
 * scripts/release-signal-logic.mjs for the policy and its rationale.
 *
 * Usage:
 *   node scripts/check-release-signal.mjs --title "<pr title>" --base <ref>
 *
 * `--base` is any git revision holding the pre-merge `package.json`. When the
 * revision cannot be read the guard fails closed rather than assuming the
 * pull request is clean.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  evaluateReleaseSignal,
  formatReleaseSignalReport,
} from './release-signal-logic.mjs';

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
 * Loads `package.json` as it exists at a given git revision.
 *
 * @param {string} ref The git revision to read from.
 * @returns {Record<string, unknown>} The parsed manifest.
 */
function readPackageAtRef(ref) {
  const stdout = execFileSync('git', ['show', `${ref}:package.json`], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return JSON.parse(stdout);
}

const title = readFlag('--title') ?? '';
const baseRef = readFlag('--base');

if (!baseRef) {
  console.error('❌ Release signal guard requires --base <git-ref>');
  process.exit(1);
}

let basePackage;
try {
  basePackage = readPackageAtRef(baseRef);
} catch (error) {
  console.error(`❌ Unable to read package.json at ${baseRef}: ${error.message}`);
  process.exit(1);
}

const headPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const verdict = evaluateReleaseSignal({ title, basePackage, headPackage });

console.log(formatReleaseSignalReport(verdict, title));
process.exit(verdict.ok ? 0 : 1);
