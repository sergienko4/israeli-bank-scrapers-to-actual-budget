/**
 * Reports the Camoufox build bundled into the running image.
 *
 * The browser binary is fetched at image build time rather than pinned to a
 * version, so the only way to tell which build a container is running is to
 * read the manifest the fetch leaves behind. Surfacing it at startup makes a
 * silent browser upgrade visible in the logs instead of a guessing game.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';

/** Manifest written by the Camoufox fetch alongside the browser binary. */
interface IBrowserManifest {
  version?: unknown;
  release?: unknown;
}

/**
 * Resolves the path of the manifest written next to the browser binary.
 * @returns Absolute path to the Camoufox version manifest.
 */
function manifestPath(): string {
  const home = os.homedir();
  return path.join(home, '.cache', 'camoufox', 'version.json');
}

/**
 * Reads the browser manifest, treating any read or parse failure as absent.
 * @returns Procedure carrying the parsed manifest, or a failure.
 */
function readManifest(): Procedure<IBrowserManifest> {
  const file = manifestPath();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as IBrowserManifest;
    return succeed(parsed);
  } catch (error: unknown) {
    const reason = errorMessage(error);
    return fail(`Camoufox manifest unavailable at ${file}: ${reason}`, { status: 'not-found' });
  }
}

/**
 * Formats a manifest into a human-readable browser description.
 *
 * Blank values are treated as absent so a half-written manifest degrades to a
 * clear failure or a bare version, never to a banner ending in empty brackets.
 * @param manifest - Parsed Camoufox version manifest.
 * @returns Procedure carrying the description, or a failure when unusable.
 */
function formatManifest(manifest: IBrowserManifest): Procedure<string> {
  const version = readText(manifest.version);
  if (version === '') return fail('Camoufox manifest has no version');
  const release = readText(manifest.release);
  if (release === '') return succeed(version);
  return succeed(`${version} (${release})`);
}

/**
 * Normalises a manifest field into trimmed text, or empty when unusable.
 * @param value - Raw manifest field of unknown type.
 * @returns The trimmed string value, or an empty string when not usable text.
 */
function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Describes the bundled browser build for the startup banner.
 * @returns Procedure carrying the description, or a failure when unavailable.
 */
export default function describeBrowserVersion(): Procedure<string> {
  const manifest = readManifest();
  if (!manifest.success) return manifest;
  return formatManifest(manifest.data);
}
