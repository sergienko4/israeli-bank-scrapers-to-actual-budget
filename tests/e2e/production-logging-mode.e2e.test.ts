/**
 * Production logging mode E2E.
 *
 * Complements the Dockerfile-parse guard in
 * `tests/deployment/ProductionLoggingMode.test.ts` by asserting the contract at
 * runtime, inside the built image, where a base-image change or a stray
 * `ENV` later in the build would still be caught.
 *
 * Scraper 8.7.1 uses `PRETTY_LOGS=true` as the sole opt-in for its pretty
 * transport, independently of `NODE_ENV`.
 */

import { execFileSync } from 'child_process';

import { describe, it, expect } from 'vitest';

import { hasDockerImage } from './helpers/dockerRunner.js';

/** Image built by the E2E setup step. */
const DOCKER_IMAGE = 'israeli-bank-importer:e2e';

/**
 * Evaluates a snippet with the image's own node binary and returns its stdout.
 * @param snippet - JavaScript source passed to `node -e`.
 * @returns Trimmed stdout produced by the snippet.
 */
function evalInImage(snippet: string): string {
  const args = ['run', '--rm', '--entrypoint', 'node', DOCKER_IMAGE, '-e', snippet];
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 60_000, stdio: 'pipe' }).trim();
}

describe.runIf(hasDockerImage())('production logging mode E2E', () => {
  it('runs with NODE_ENV=production', () => {
    const nodeEnv = evalInImage('process.stdout.write(process.env.NODE_ENV ?? "<unset>")');

    expect(nodeEnv).toBe('production');
  });

  it('runs with the scraper pretty transport explicitly disabled', () => {
    const prettyLogs = evalInImage(
      'process.stdout.write(process.env.PRETTY_LOGS ?? "<unset>")',
    );

    expect(prettyLogs).toBe('false');
  });
});
