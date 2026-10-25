/**
 * Guards the browser stack against the pair the provider was tested with.
 *
 * The provider names the Camoufox build and the playwright-core minor its
 * suite ran against, and only logs a warning at run time when the install
 * differs. A provider update that moves either one would ship an untested
 * pair, so these checks fail the update until config/camoufox-pin.json and
 * the playwright-core that camoufox-js loads match what the provider names.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parsePin } from '../../scripts/camoufox-pin-logic.mjs';
import { anchored, providerBundle } from '../helpers/UpstreamBundle.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Reads one string constant the provider's bundle declares.
 * @param name - The constant's name.
 * @returns Its value; throws when the provider no longer declares it.
 */
function testedConstant(name: string): string {
  return anchored(providerBundle(), new RegExp(`var ${name} = "(?<value>[^"]+)";`, 'u'));
}

/**
 * Finds the manifest of the copy of a package that one file would load.
 * @param from - The file that loads it.
 * @param name - The package's name.
 * @returns The path of that copy's package.json.
 */
function manifestFrom(from: string, name: string): string {
  const dirs = createRequire(from).resolve.paths(name) ?? [];
  const found = dirs.map((dir) => join(dir, name, 'package.json')).find((file) => existsSync(file));
  if (found === undefined) throw new Error(`${name} is not installed where ${from} looks`);
  return found;
}

describe('the browser stack the provider was tested with', () => {
  it('pins the Camoufox build the provider names', () => {
    const pin = parsePin(JSON.parse(readFileSync(join(ROOT, 'config/camoufox-pin.json'), 'utf8')));
    expect(`v${pin.version}-${pin.release}`).toBe(testedConstant('TESTED_CAMOUFOX_TAG'));
  });

  it('loads the playwright-core minor the provider names through camoufox-js', () => {
    const provider = manifestFrom(join(ROOT, 'package.json'), '@sergienko4/israeli-bank-scrapers');
    const camoufox = manifestFrom(provider, '@hieutran094/camoufox-js');
    const manifest = JSON.parse(readFileSync(manifestFrom(camoufox, 'playwright-core'), 'utf8')) as { version: string };
    expect(manifest.version.split('.').slice(0, 2).join('.')).toBe(testedConstant('TESTED_PLAYWRIGHT_MINOR'));
  });
});
