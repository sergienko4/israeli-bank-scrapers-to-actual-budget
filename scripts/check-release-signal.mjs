#!/usr/bin/env node
/**
 * Release-signal CI guard.
 *
 * Fails a pull request that changes a dependency or base image shipped inside
 * the published Docker image while carrying a title release-please will not
 * release on. See scripts/release-signal-logic.mjs for the policy and its
 * rationale.
 *
 * Usage:
 *   node scripts/check-release-signal.mjs --title "<pr title>" --base <ref>
 *
 * `--base` is any git revision holding the pre-merge `package.json` and
 * `Dockerfile`. When `package.json` cannot be read the guard fails closed
 * rather than assuming the pull request is clean.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

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
 * Loads a repository file as it exists at a given git revision.
 *
 * @param {string} ref The git revision to read from.
 * @param {string} path The repository-relative path to read.
 * @returns {string} The file contents at that revision.
 */
function readFileAtRef(ref, path) {
  return execFileSync('git', ['show', `${ref}:${path}`], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

/**
 * Loads a repository file that may legitimately be absent at a revision.
 *
 * Returns an empty string rather than throwing so that adding or deleting the
 * Dockerfile registers as a base-image change instead of failing the guard.
 *
 * @param {string} ref The git revision to read from.
 * @param {string} path The repository-relative path to read.
 * @returns {string} The file contents, or an empty string when absent.
 */
function readOptionalFileAtRef(ref, path) {
  try {
    return readFileAtRef(ref, path);
  } catch {
    return '';
  }
}

const title = readFlag('--title') ?? '';
const baseRef = readFlag('--base');

if (!baseRef) {
  console.error('❌ Release signal guard requires --base <git-ref>');
  process.exit(1);
}

let basePackage;
try {
  basePackage = JSON.parse(readFileAtRef(baseRef, 'package.json'));
} catch (error) {
  console.error(`❌ Unable to read package.json at ${baseRef}: ${error.message}`);
  process.exit(1);
}

const repoRoot = new URL('../', import.meta.url);
const headPackage = JSON.parse(readFileSync(new URL('package.json', repoRoot), 'utf8'));
const baseDockerfile = readOptionalFileAtRef(baseRef, 'Dockerfile');
const headDockerfile = existsSync(new URL('Dockerfile', repoRoot))
  ? readFileSync(new URL('Dockerfile', repoRoot), 'utf8')
  : '';

const verdict = evaluateReleaseSignal({
  title,
  basePackage,
  headPackage,
  baseDockerfile,
  headDockerfile,
});

console.log(formatReleaseSignalReport(verdict, title));
process.exit(verdict.ok ? 0 : 1);
