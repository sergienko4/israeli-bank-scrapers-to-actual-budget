/**
 * Guards the two-stage layout of the published image.
 *
 * The build stage and the runtime stage each name the base image. Native
 * modules such as better-sqlite3 are installed in the build stage and run in
 * the runtime stage, so the two must be the same image: a digest bump applied
 * to one FROM line only would ship binaries built against a different system.

 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseBaseImages } from '../../scripts/release-signal-logic.mjs';

/** Dockerfile that produces the published importer image. */
const DOCKERFILE = fileURLToPath(new URL('../../Dockerfile', import.meta.url));

/** A base image reference pinned to an immutable content digest. */
const DIGEST_PINNED = /@sha256:[0-9a-f]{64}$/;

describe('published image stage layout', () => {
  it('builds every stage from one digest-pinned base image', () => {
    const images = parseBaseImages(readFileSync(DOCKERFILE, 'utf8'));

    expect(images.length).toBeGreaterThan(1);
    expect(new Set(images)).toEqual(new Set([images[0]]));
    expect(images[0]).toMatch(DIGEST_PINNED);
  });
});
