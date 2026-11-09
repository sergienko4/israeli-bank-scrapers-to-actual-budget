/**
 * Published image contents E2E.
 *
 * The image is built in two stages so that no browser binary, devDependencies
 * or build tooling ship in the runtime image. These checks run against the
 * built image, so they catch a Dockerfile edit that quietly reintroduces a
 * browser layer, devDependencies or a package manager, or that drops a file
 * the runtime needs.
 */

import { execFileSync } from 'child_process';

import { describe, it, expect } from 'vitest';

import { hasDockerImage } from './helpers/dockerRunner.js';

/** Image the E2E job builds before running this suite. */
const DOCKER_IMAGE = 'israeli-bank-importer:e2e';

/** Shell the shell-form HEALTHCHECK runs through. */
const EXPECTED_SHELL = ['/bin/bash', '-o', 'pipefail', '-c'];

/** Builds a scraper through the public API and reports whether it can scrape. */
const SCRAPER_API = `
import { createScraper } from '@sergienko4/israeli-bank-scrapers';
const scraper = createScraper({ companyId: 'hapoalim', startDate: new Date() });
process.stdout.write(typeof scraper.scrape);
`;

/** Opens and closes an in-memory database through the native module. */
const SQLITE_OPEN = `
import Database from 'better-sqlite3';
const db = new Database(':memory:');
db.close();
process.stdout.write('ok');
`;

/**
 * Runs a docker CLI command and returns its output.
 * @param args - Arguments passed to the docker CLI.
 * @param timeoutMs - Upper bound for the command.
 * @returns Trimmed stdout of the command.
 */
function docker(args: readonly string[], timeoutMs = 30_000): string {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: timeoutMs, stdio: 'pipe' }).trim();
}

/**
 * Runs a command inside a fresh container of the image as its default user.
 * @param entrypoint - Executable that replaces the image entrypoint.
 * @param args - Arguments passed to the entrypoint.
 * @returns Trimmed stdout of the command.
 */
function runInImage(entrypoint: string, args: readonly string[]): string {
  return docker(['run', '--rm', '--entrypoint', entrypoint, DOCKER_IMAGE, ...args], 150_000);
}

describe.runIf(hasDockerImage())('published image contents E2E', () => {
  it('ships no Camoufox browser binary or Playwright runtime', () => {
    const check = runInImage('node', [
      '-e',
      [
        'const fs = require("fs");',
        'const hasCache = fs.existsSync("/home/node/.cache/camoufox");',
        'let hasPlaywright = false;',
        'try { require.resolve("playwright-core"); hasPlaywright = true; } catch {}',
        'process.stdout.write(JSON.stringify({ hasCache, hasPlaywright }));',
      ].join(' '),
    ]);

    expect(JSON.parse(check)).toEqual({ hasCache: false, hasPlaywright: false });
  });

  it('runs the health check through bash with pipefail', () => {
    const inspected = docker(['image', 'inspect', '--format', '{{json .Config.Shell}}', DOCKER_IMAGE]);
    const shell: unknown = JSON.parse(inspected);

    expect(shell).toEqual(EXPECTED_SHELL);
  });

  it('ships no devDependencies', () => {
    const resolved = runInImage('node', [
      '-e',
      'try { require.resolve("vitest"); process.stdout.write("present"); } catch { process.stdout.write("absent"); }',
    ]);

    expect(resolved).toBe('absent');
  });

  it('ships no package manager on PATH', () => {
    const found = runInImage('bash', ['-c', 'command -v npm npx corepack yarn yarnpkg || true']);

    expect(found).toBe('');
  });

  it('ships the config portal assets the server falls back to', () => {
    const present = runInImage('node', [
      '-e',
      'process.stdout.write(String(require("fs").existsSync("/app/src/Portal/Public/index.html")))',
    ]);

    expect(present).toBe('true');
  });

  it('exposes the scraper API', () => {
    const scrapeType = runInImage('node', ['--input-type=module', '-e', SCRAPER_API]);

    expect(scrapeType).toBe('function');
  });

  it('loads the better-sqlite3 native module', () => {
    const opened = runInImage('node', ['--input-type=module', '-e', SQLITE_OPEN]);

    expect(opened).toBe('ok');
  });
});
