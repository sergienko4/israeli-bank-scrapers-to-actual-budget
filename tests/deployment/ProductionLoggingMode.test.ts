/**
 * Guards the production logging mode of the shipped image.
 *
 * Scraper 8.7.1 attaches its `pino-pretty` transport only when
 * `PRETTY_LOGS=true`. The image pins that opt-in off so production containers
 * do not spawn the transport's worker thread accidentally.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** Dockerfile that produces the published importer image. */
const DOCKERFILE = fileURLToPath(new URL('../../Dockerfile', import.meta.url));

/** Matches an `ENV NODE_ENV=production` declaration in either Docker syntax. */
const NODE_ENV_PRODUCTION = /^\s*ENV\s+NODE_ENV[= ]["']?production["']?\s*$/m;

/** Matches an explicit `ENV PRETTY_LOGS=false` image default. */
const PRETTY_LOGS_DISABLED = /^\s*ENV\s+PRETTY_LOGS[= ]["']?false["']?\s*$/m;

describe('shipped image production logging mode', () => {
  it(
    'pins NODE_ENV=production for the application runtime',
    /**
     * Verifies the image declares the application's production runtime mode.
     * @returns Nothing.
     */
    () => {
      const dockerfile = readFileSync(DOCKERFILE, 'utf8');

      expect(dockerfile).toMatch(NODE_ENV_PRODUCTION);
    },
  );

  it(
    'disables the scraper pretty transport explicitly',
    /**
     * Verifies the image opts out of the scraper's pretty transport.
     * @returns Nothing.
     */
    () => {
      const dockerfile = readFileSync(DOCKERFILE, 'utf8');

      expect(dockerfile).toMatch(PRETTY_LOGS_DISABLED);
    },
  );

  it('declares NODE_ENV before the process starts, not inside CMD', () => {
    const dockerfile = readFileSync(DOCKERFILE, 'utf8');
    const envLine = dockerfile.split('\n').findIndex((line) => NODE_ENV_PRODUCTION.test(line));
    const cmdLine = dockerfile.split('\n').findIndex((line) => line.startsWith('CMD'));

    expect(envLine).toBeGreaterThan(-1);
    expect(envLine).toBeLessThan(cmdLine);
  });
});
