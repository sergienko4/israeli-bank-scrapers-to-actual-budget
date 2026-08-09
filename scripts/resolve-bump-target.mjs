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
 * reproduce the manifest's existing intent. It handles the range forms used by
 * the dependencies and devDependencies it can target — `^`, `~` and bare exact
 * versions — and refuses anything else, such as a compound range or a
 * `git:`/`file:` specifier, rather than guessing at how to reproduce it.
 *
 * It also reports whether the package reaches users, which decides the commit
 * type the workflow will accept. That answer comes from the lockfile, not from
 * the manifest section: see {@link isShipped}.
 *
 * Usage:
 *   node scripts/resolve-bump-target.mjs --package <name>
 *
 * Writes `section`, `saveFlag`, `prefixFlag` and `shipped` to `$GITHUB_OUTPUT`
 * when it is set, and always echoes them for local use. Exits non-zero, with the
 * reason on stderr, when the request cannot be honoured.
 */

import { appendFileSync, readFileSync } from 'node:fs';

/** Manifest sections a bump may target, mapped to the npm flag that saves there. */
const SUPPORTED_SECTIONS = Object.freeze({
  dependencies: '--save-prod',
  devDependencies: '--save-dev',
});

/** Ranges this resolver can reproduce: a caret or tilde range, or a bare exact version. */
const SUPPORTED_RANGE = /^[~^]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** npm flag that re-saves a version using the operator the manifest already uses. */
const PREFIX_FLAGS = Object.freeze({
  '^': '--save-prefix=^',
  '~': '--save-prefix=~',
  '': '--save-exact',
});

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
    // Without this, npm re-saves the version with its own configured prefix,
    // quietly widening a deliberate `~` or exact pin into a caret range.
    prefixFlag: PREFIX_FLAGS[/^[~^]/.test(spec) ? spec[0] : ''],
    spec,
  };
}

/**
 * Reads a JSON file from the repository root, refusing the run if it cannot be
 * read or parsed.
 *
 * @param {string} file The file name, relative to the repository root.
 * @returns {Record<string, any>} The parsed contents.
 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  } catch (error) {
    return refuse(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Reports whether a package is installed into the published image.
 *
 * The manifest section cannot answer this. `npm prune --omit=dev` keeps every
 * package the production graph reaches, so a devDependency that a runtime
 * dependency also requires survives the prune and ships — which is true here of
 * `playwright-core` and `@hieutran094/camoufox-js`, both pulled in by the
 * scraper. The lockfile records that reachability, and marks a package `dev`
 * only when nothing in production needs it.
 *
 * @param {Record<string, any>} lockfile The parsed lockfile.
 * @param {string} name The package being bumped.
 * @returns {boolean} True when the package reaches users.
 */
function isShipped(lockfile, name) {
  const entry = lockfile.packages?.[`node_modules/${name}`];
  if (!entry) {
    refuse(`${name} has no package-lock.json entry, so whether it ships cannot be determined. Install and commit the lockfile first.`);
  }
  return entry.dev !== true;
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

  const { section, saveFlag, prefixFlag, spec } = resolveTarget(readJson('package.json'), name);
  const shipped = isShipped(readJson('package-lock.json'), name);
  publish({ section, saveFlag, prefixFlag, shipped: String(shipped) });
  process.stdout.write(
    `${name} is in ${section} as "${spec}"; saving with ${saveFlag} ${prefixFlag}; ships to users: ${shipped}\n`,
  );
}

main();
