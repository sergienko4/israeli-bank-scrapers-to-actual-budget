#!/usr/bin/env node
/**
 * Bump-target resolver for the on-demand dependency-bump workflow.
 *
 * `npm install <pkg>@<version>` is not safe to run blind. It happily *adds* a
 * package that is not currently a dependency, so a typo in a dispatch input
 * would introduce a new production dependency rather than fail. It also
 * rewrites the saved range using npm's configured save-prefix, which turns a
 * deliberately narrow pin such as `~1.62.1` into `^1.62.2` and silently widens
 * what the lockfile is allowed to resolve to. Neither is visible in the
 * resulting diff without reading it closely.
 *
 * This resolver refuses those cases up front and reports the npm flags that
 * reproduce the manifest's existing intent.
 *
 * Usage:
 *   node scripts/resolve-bump-target.mjs --package <name>
 *
 * Writes `section`, `saveFlag` and `prefixFlag` to `$GITHUB_OUTPUT` when it is
 * set, and always echoes them for local use. Exits non-zero, with the reason on
 * stderr, when the request cannot be honoured.
 */

import { appendFileSync, readFileSync } from 'node:fs';

/** Manifest sections a bump may target, mapped to the npm flag that saves there. */
const SUPPORTED_SECTIONS = Object.freeze({
  dependencies: '--save-prod',
  devDependencies: '--save-dev',
});

/** Ranges this resolver can reproduce: a caret range or a bare exact version. */
const SUPPORTED_RANGE = /^\^?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Reads a named `--flag value` argument from the process arguments.
 *
 * @param {string} flag The flag to read, including its leading dashes.
 * @returns {string | undefined} The value that follows the flag, if present.
 */
function readFlag(flag) {
  const at = process.argv.indexOf(flag);
  return at === -1 ? undefined : process.argv[at + 1];
}

/**
 * Fails the process with a reason an operator can act on.
 *
 * @param {string} reason Why the bump cannot proceed.
 * @returns {never}
 */
function refuse(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(1);
}

/**
 * Finds the manifest sections that already declare a package.
 *
 * @param {Record<string, Record<string, string>>} manifest The parsed manifest.
 * @param {string} name The package being bumped.
 * @returns {string[]} Every supported section declaring the package.
 */
function locate(manifest, name) {
  return Object.keys(SUPPORTED_SECTIONS).filter((section) => manifest[section]?.[name]);
}

/**
 * Resolves which manifest section declares a package, refusing anything the
 * workflow cannot bump safely.
 *
 * @param {Record<string, Record<string, string>>} manifest The parsed manifest.
 * @param {string} name The package being bumped.
 * @returns {string} The single supported section declaring the package.
 */
function requireSingleSection(manifest, name) {
  const found = locate(manifest, name);

  if (found.length === 0) {
    refuse(
      manifest.overrides?.[name]
        ? `${name} is only an entry in "overrides", which npm install cannot update. Edit the override by hand.`
        : `${name} is not in "dependencies" or "devDependencies". Installing it would add a new dependency rather than bump one; check the spelling.`,
    );
  }

  if (found.length > 1) {
    refuse(`${name} is declared in ${found.join(' and ')}. Resolve that ambiguity before bumping it.`);
  }

  return found[0];
}

/**
 * Resolves where a package lives and how its range must be saved.
 *
 * @param {Record<string, Record<string, string>>} manifest The parsed manifest.
 * @param {string} name The package being bumped.
 * @returns {{ section: string, saveFlag: string, prefixFlag: string, spec: string }} The resolution.
 */
function resolveTarget(manifest, name) {
  const section = requireSingleSection(manifest, name);
  const spec = manifest[section][name];

  if (!SUPPORTED_RANGE.test(spec)) {
    refuse(`${name} is pinned as "${spec}", which this workflow cannot reproduce. Bump it by hand.`);
  }

  return {
    section,
    saveFlag: SUPPORTED_SECTIONS[section],
    // Without this, npm rewrites an exact pin as a caret range and quietly
    // widens what the lockfile may resolve to on the next install.
    prefixFlag: spec.startsWith('^') ? '--save-prefix=^' : '--save-exact',
    spec,
  };
}

/**
 * Reads the repository manifest, refusing the run if it cannot be parsed.
 *
 * @returns {Record<string, Record<string, string>>} The parsed manifest.
 */
function readManifest() {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  } catch (error) {
    return refuse(`Could not read package.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Publishes the resolved flags as step outputs when running inside Actions.
 *
 * @param {Record<string, string>} outputs The values to expose to later steps.
 * @returns {void}
 */
function publish(outputs) {
  if (!process.env.GITHUB_OUTPUT) return;

  const body = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('');
  appendFileSync(process.env.GITHUB_OUTPUT, body);
}

/**
 * Validates the requested package and publishes the flags that bump it safely.
 *
 * @returns {void}
 */
function main() {
  const name = readFlag('--package');
  if (!name) refuse('Usage: node scripts/resolve-bump-target.mjs --package <name>');

  const { section, saveFlag, prefixFlag, spec } = resolveTarget(readManifest(), name);
  publish({ section, saveFlag, prefixFlag });
  process.stdout.write(`${name} is in ${section} as "${spec}"; saving with ${saveFlag} ${prefixFlag}\n`);
}

main();
