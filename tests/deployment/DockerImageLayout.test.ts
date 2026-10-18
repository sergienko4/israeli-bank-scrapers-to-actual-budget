/**
 * Guards the two-stage layout of the published image.
 *
 * The build stage and the runtime stage each name the base image. Native
 * modules such as better-sqlite3 are installed in the build stage and run in
 * the runtime stage, so the two must be the same image: a digest bump applied
 * to one FROM line only would ship binaries built against a different system.
 *
 * The build context is an allowlist, so a new COPY source that is not
 * re-included in .dockerignore would fail the build only once it runs.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseBaseImages } from '../../scripts/release-signal-logic.mjs';

/** Dockerfile that produces the published importer image. */
const DOCKERFILE = fileURLToPath(new URL('../../Dockerfile', import.meta.url));

/** Build-context allowlist next to the Dockerfile. */
const DOCKERIGNORE = fileURLToPath(new URL('../../.dockerignore', import.meta.url));

/** A base image reference pinned to an immutable content digest. */
const DIGEST_PINNED = /@sha256:[0-9a-f]{64}$/;

/**
 * Strips trailing slashes so `src/` and `src` compare equal.
 * @param path - Build-context path as written in a Dockerfile or .dockerignore.
 * @returns The path without trailing slashes.
 */
function normalise(path: string): string {
  return path.replace(/\/+$/, '');
}

/**
 * Lists the build-context sources of every COPY that does not read from a stage.
 * @param dockerfile - Dockerfile text.
 * @returns Source paths, one per copied file or directory.
 */
function contextCopySources(dockerfile: string): string[] {
  const copies = dockerfile.split('\n').filter((line) => /^COPY\s/.test(line) && !line.includes('--from='));
  return copies.flatMap((line) => {
    const operands = line.split(/\s+/).slice(1).filter((token) => !token.startsWith('--'));
    return operands.slice(0, -1).map(normalise);
  });
}

/**
 * Lists the paths a `*`-first .dockerignore re-includes with `!` rules.
 * @param dockerignore - .dockerignore text.
 * @returns Re-included paths.
 */
function reincludedPaths(dockerignore: string): string[] {
  const rules = dockerignore.split('\n').map((line) => line.trim());
  return rules.filter((rule) => rule.startsWith('!')).map((rule) => normalise(rule.slice(1)));
}

describe('published image stage layout', () => {
  it('builds every stage from one digest-pinned base image', () => {
    const images = parseBaseImages(readFileSync(DOCKERFILE, 'utf8'));

    expect(images.length).toBeGreaterThan(1);
    expect(new Set(images)).toEqual(new Set([images[0]]));
    expect(images[0]).toMatch(DIGEST_PINNED);
  });

  it('sends every COPY source through the build-context allowlist', () => {
    const dockerignore = readFileSync(DOCKERIGNORE, 'utf8');
    const allowed = reincludedPaths(dockerignore);
    const sources = contextCopySources(readFileSync(DOCKERFILE, 'utf8'));

    const blocked = sources.filter((source) => !allowed.some((path) => source === path || source.startsWith(`${path}/`)));

    expect(dockerignore.split('\n')).toContain('*');
    expect(sources).not.toHaveLength(0);
    expect(blocked).toEqual([]);
  });
});
