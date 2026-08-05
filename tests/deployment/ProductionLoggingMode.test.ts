/**
 * Guards the production logging mode of the shipped image.
 *
 * Outside production the scraper attaches a `pino-pretty` transport, and
 * `pino({ transport })` starts a `thread-stream` worker thread that owns a 4 MB
 * SharedArrayBuffer and a `process` exit listener. On scraper 8.6.2 the root
 * logger was cached only when a log file was configured, so that cost one worker
 * per log call: a real Discount scrape measured 14,336 MB peak RSS (OOM-killed)
 * with `NODE_ENV` unset versus 1,008 MB with it set to `production` — a 14x
 * difference produced by this single variable. Scraper 8.6.3 caches the root
 * logger per destination, but production mode still stops the transport being
 * attached at all, so the image must pin it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** Dockerfile that produces the published importer image. */
const DOCKERFILE = fileURLToPath(new URL('../../Dockerfile', import.meta.url));

/** Matches an `ENV NODE_ENV=production` declaration in either Docker syntax. */
const NODE_ENV_PRODUCTION = /^\s*ENV\s+NODE_ENV[= ]["']?production["']?\s*$/m;

describe('shipped image production logging mode', () => {
  it('pins NODE_ENV=production so the scraper logger never spawns worker threads', () => {
    const dockerfile = readFileSync(DOCKERFILE, 'utf8');

    expect(dockerfile).toMatch(NODE_ENV_PRODUCTION);
  });

  it('declares NODE_ENV before the process starts, not inside CMD', () => {
    const dockerfile = readFileSync(DOCKERFILE, 'utf8');
    const envLine = dockerfile.split('\n').findIndex((line) => NODE_ENV_PRODUCTION.test(line));
    const cmdLine = dockerfile.split('\n').findIndex((line) => line.startsWith('CMD'));

    expect(envLine).toBeGreaterThan(-1);
    expect(envLine).toBeLessThan(cmdLine);
  });
});
