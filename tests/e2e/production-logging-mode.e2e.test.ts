/**
 * Production logging mode E2E.
 *
 * Complements the Dockerfile-parse guard in
 * `tests/deployment/ProductionLoggingMode.test.ts` by asserting the contract at
 * runtime, inside the built image, where a base-image change or a stray
 * `ENV NODE_ENV` later in the build would still be caught.
 *
 * The scraper library only memoises its root logger when a log file is
 * configured; outside production it attaches a `pino-pretty` transport, and
 * `pino({ transport })` starts a `thread-stream` worker thread holding a 4 MB
 * SharedArrayBuffer plus a `process` exit listener. Un-memoised, that is one
 * worker per log call. A measured Discount scrape peaked at 14,336 MB RSS
 * (OOM-killed) with `NODE_ENV` unset and 1,008 MB with it pinned.
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
  it('runs with NODE_ENV=production so the scraper logger stays worker-free', () => {
    const nodeEnv = evalInImage('process.stdout.write(process.env.NODE_ENV ?? "<unset>")');

    expect(nodeEnv).toBe('production');
  });
});
