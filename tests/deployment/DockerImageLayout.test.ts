/**
 * Guards the repository's Docker builds.
 *
 * The build stage and the runtime stage each name the base image. Native
 * modules such as better-sqlite3 are installed in the build stage and run in
 * the runtime stage, so the two must be the same image: a digest bump applied
 * to one FROM line only would ship binaries built against a different system.
 *
 * Every build context is an allowlist, so a COPY source that is not
 * re-included would fail the build only once it runs. BuildKit applies a
 * Dockerfile's sibling `<name>.dockerignore` when one exists and the context's
 * .dockerignore otherwise, so each Dockerfile is checked against its own.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseBaseImages } from '../../scripts/release-signal-logic.mjs';

/** Dockerfile that produces the published importer image. */
const DOCKERFILE = fileURLToPath(new URL('../../Dockerfile', import.meta.url));

/** Repository root, the build context of every Dockerfile in the repository. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

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
 * Splits text into trimmed, non-blank lines, whether it uses LF or CRLF.
 * @param text - Dockerfile or .dockerignore text.
 * @returns Lines without surrounding whitespace.
 */
function trimmedLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
}

/**
 * Lists the build-context sources of every COPY that does not read from a stage.
 * @param dockerfile - Dockerfile text.
 * @returns Source paths, one per copied file or directory.
 */
function contextCopySources(dockerfile: string): string[] {
  const instructions = trimmedLines(dockerfile.replace(/\\\r?\n/g, ' '));
  const copies = instructions.filter((line) => /^COPY\s/.test(line) && !line.includes('--from='));
  return copies.flatMap((line) => {
    const operands = line.split(/\s+/).slice(1).filter((token) => !token.startsWith('--'));
    return operands.slice(0, -1).map(normalise);
  });
}

/**
 * Lists every Dockerfile in the repository, tracked or not yet added.
 * @returns Repository-relative Dockerfile paths.
 */
function dockerfiles(): string[] {
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (listed.status !== 0) throw new Error(`git ls-files failed in ${ROOT}: ${listed.stderr}`);
  return listed.stdout.split('\0').filter((file) => /(^|\/)Dockerfile[^/]*$/.test(file) && !file.endsWith('.dockerignore'));
}

/**
 * Resolves the ignore file BuildKit applies when building from the repository root.
 * @param dockerfile - Repository-relative Dockerfile path.
 * @returns The Dockerfile's own ignore file if present, else the root .dockerignore.
 */
function ignoreFileFor(dockerfile: string): string {
  const own = `${dockerfile}.dockerignore`;
  return existsSync(join(ROOT, own)) ? own : '.dockerignore';
}

/**
 * Lists the active rules of a .dockerignore, in order.
 * @param dockerignore - .dockerignore text.
 * @returns Rules without comments and blank lines.
 */
function ignoreRules(dockerignore: string): string[] {
  return trimmedLines(dockerignore).filter((line) => !line.startsWith('#'));
}

describe('Docker build layout', () => {
  it('builds every stage from one digest-pinned base image', () => {
    const images = parseBaseImages(readFileSync(DOCKERFILE, 'utf8'));

    expect(images.length).toBeGreaterThan(1);
    expect(new Set(images)).toEqual(new Set([images[0]]));
    expect(images[0]).toMatch(DIGEST_PINNED);
  });

  it('finds the published and the local-overlay Dockerfiles', () => {
    expect(dockerfiles()).toEqual(expect.arrayContaining(['Dockerfile', 'tests/e2e/local-stack/Dockerfile.overlay']));
  });

  it.each(dockerfiles())('sends every COPY source of %s through its build-context allowlist', (dockerfile) => {
    const rules = ignoreRules(readFileSync(join(ROOT, ignoreFileFor(dockerfile)), 'utf8'));
    const allowed = rules.filter((rule) => rule.startsWith('!')).map((rule) => normalise(rule.slice(1)));
    const sources = contextCopySources(readFileSync(join(ROOT, dockerfile), 'utf8'));

    const blocked = sources.filter((source) => !allowed.some((path) => source === path || source.startsWith(`${path}/`)));

    expect(rules[0]).toBe('*');
    expect(sources).not.toHaveLength(0);
    expect(blocked).toEqual([]);
  });
});
