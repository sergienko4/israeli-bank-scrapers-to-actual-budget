/**
 * Published image contents E2E.
 *
 * The image is built in two stages so that Camoufox (1.2 GB) ships once and
 * no build tooling ships at all. These checks run against the built image,
 * so they catch a Dockerfile edit that quietly reintroduces a duplicate
 * Camoufox layer, devDependencies or a package manager, or that drops a
 * file the runtime needs.
 */

import { execFileSync } from 'child_process';

import { describe, it, expect } from 'vitest';

import { hasDockerImage } from './helpers/dockerRunner.js';

/** Image the E2E job builds before running this suite. */
const DOCKER_IMAGE = 'israeli-bank-importer:e2e';

/** Only the Camoufox install is this large; any second one is a duplicate. */
const CAMOUFOX_SIZED_LAYER_BYTES = 1_000_000_000;

/** Shell the shell-form HEALTHCHECK runs through. */
const EXPECTED_SHELL = ['/bin/bash', '-o', 'pipefail', '-c'];

/** Launches the shipped Camoufox with the scraper's default OS fingerprint and reports the platform. */
const CAMOUFOX_LAUNCH = `
import { Camoufox } from '@hieutran094/camoufox-js';
const browser = await Camoufox({ headless: true, os: 'windows' });
const page = await browser.newPage();
const platform = await page.evaluate(() => navigator.platform);
await browser.close();
process.stdout.write(platform);
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
  it('ships Camoufox in exactly one layer', () => {
    const history = docker(['history', '--no-trunc', '--human=false', '--format', '{{.Size}}', DOCKER_IMAGE]);
    const layerBytes = history.split('\n').map(Number);

    const camoufoxSized = layerBytes.filter((bytes) => bytes >= CAMOUFOX_SIZED_LAYER_BYTES);

    expect(camoufoxSized).toHaveLength(1);
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

  it('launches the shipped Camoufox headless', () => {
    const platform = runInImage('node', ['--input-type=module', '-e', CAMOUFOX_LAUNCH]);

    expect(platform).toBe('Win32');
  }, 180_000);
});
