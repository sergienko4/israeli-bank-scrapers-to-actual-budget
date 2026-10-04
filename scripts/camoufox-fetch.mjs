/**
 * Installs, or with --verify checks, the Camoufox build pinned in
 * config/camoufox-pin.json. Every install site runs this instead of
 * `camoufox-js fetch`, which installs whatever build upstream published last:
 * the Dockerfile, the CI cache action and `npm run camoufox:install`.
 *
 * Usage: node scripts/camoufox-fetch.mjs [--verify]
 *   (no flag)  install the pinned build unless it is already installed
 *   --verify   exit 1 unless the installed build is the pinned one
 *
 * "Installed" means version.json names the pinned build, the installer's
 * record names this platform's asset and its digest, and the executable
 * camoufox-js launches is present.
 *
 * The install directory is CAMOUFOX_INSTALL_DIR, else camoufox-js's default.
 * Only a download imports camoufox-js, so with CAMOUFOX_INSTALL_DIR set,
 * --verify and an up-to-date install need nothing but Node.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  INSTALLED_ASSET_FILE,
  launchFileFor,
  matchesAsset,
  matchesPin,
  parsePin,
  PIN_FILE,
  selectAsset,
} from './camoufox-pin-logic.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const USAGE = 'Usage: node scripts/camoufox-fetch.mjs [--verify]';

/**
 * Reads a JSON file the install left behind.
 * @param {string} file - Path of the file.
 * @returns {unknown} Parsed contents, or undefined when absent or unreadable.
 */
function readInstallRecord(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // A missing or corrupt record means the pinned build is not installed.
    return undefined;
  }
}

/**
 * Tells whether the install directory holds the pinned build for this platform.
 * @param {string} installDir - Camoufox install directory.
 * @param {import('./camoufox-pin-logic.d.mts').ICamoufoxPin} pin - Validated pin.
 * @param {import('./camoufox-pin-logic.d.mts').ISelectedAsset} asset - Asset for this platform.
 * @returns {boolean} True when version, asset record and executable all match.
 */
function isPinnedInstall(installDir, pin, asset) {
  return (
    matchesPin(pin, readInstallRecord(join(installDir, 'version.json'))) &&
    matchesAsset(asset, readInstallRecord(join(installDir, INSTALLED_ASSET_FILE))) &&
    existsSync(join(installDir, launchFileFor(asset.key)))
  );
}

/**
 * Resolves the directory camoufox-js installs to and launches from.
 * @returns {Promise<string>} Absolute install directory.
 */
async function resolveInstallDir() {
  const configured = process.env.CAMOUFOX_INSTALL_DIR;
  if (configured) return resolve(configured);
  const { INSTALL_DIR } = await import('@hieutran094/camoufox-js/dist/pkgman.js');
  return INSTALL_DIR;
}

/**
 * Installs or verifies the pinned build.
 * @param {string[]} args - Command-line arguments after the script path.
 * @returns {Promise<number>} Process exit code.
 */
async function run(args) {
  const verifyOnly = args.length === 1 && args[0] === '--verify';
  if (args.length > 0 && !verifyOnly) {
    console.error(USAGE);
    return 1;
  }
  const pin = parsePin(JSON.parse(readFileSync(join(REPO_ROOT, PIN_FILE), 'utf8')));
  const asset = selectAsset(pin, process.platform, process.arch);
  const build = `${pin.version}-${pin.release} (${asset.key})`;
  const installDir = await resolveInstallDir();
  if (isPinnedInstall(installDir, pin, asset)) {
    console.log(`Camoufox ${build} is installed at ${installDir}`);
    return 0;
  }
  if (verifyOnly) {
    console.error(`Camoufox at ${installDir} is not ${build}, the build pinned in ${PIN_FILE}`);
    return 1;
  }
  const { PinnedCamoufoxFetcher } = await import('./camoufox-pinned-fetcher.mjs');
  await new PinnedCamoufoxFetcher(asset).install();
  console.log(`Installed Camoufox ${build} at ${installDir}`);
  return 0;
}

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
