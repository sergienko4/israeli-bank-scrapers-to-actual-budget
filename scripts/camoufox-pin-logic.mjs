/**
 * Rules for the Camoufox browser pin, config/camoufox-pin.json: the pin
 * schema, the mapping from a Node platform to a Camoufox asset, and whether
 * an installed build is the pinned one. Pure functions with no I/O, shared by
 * scripts/camoufox-fetch.mjs and the tests.
 */

/** Repository-relative path of the pin file, named in every error. */
export const PIN_FILE = 'config/camoufox-pin.json';

/**
 * File the pinned installer writes into the install directory, recording the
 * asset key and archive digest it installed. version.json alone names a build
 * but not the platform or the archive it came from.
 */
export const INSTALLED_ASSET_FILE = 'pinned-asset.json';

/** Node `process.platform` to the Camoufox asset OS name. */
const OS_KEYS = new Map([
  ['linux', 'lin'],
  ['darwin', 'mac'],
  ['win32', 'win'],
]);

/** Node `process.arch` to the Camoufox asset architecture name. */
const ARCH_KEYS = new Map([
  ['x64', 'x86_64'],
  ['arm64', 'arm64'],
  ['ia32', 'i686'],
]);

/** Asset platforms camoufox-js can launch (its OS_ARCH_MATRIX). */
const SUPPORTED_ASSET_KEYS = new Set([
  'lin.x86_64',
  'lin.arm64',
  'lin.i686',
  'mac.x86_64',
  'mac.arm64',
  'win.x86_64',
  'win.i686',
]);

/** Asset OS name to the executable camoufox-js launches (its LAUNCH_FILE). */
const LAUNCH_FILES = new Map([
  ['lin', 'camoufox-bin'],
  ['mac', 'Camoufox.app/Contents/MacOS/camoufox'],
  ['win', 'camoufox.exe'],
]);

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const RELEASE_PATTERN = /^(?:alpha|beta)\.\d+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DOWNLOAD_PREFIX = 'https://github.com/daijro/camoufox/releases/download/';

/**
 * Throws a pin validation error that names the pin file.
 * @param {string} message - What is wrong.
 * @returns {never} Never returns.
 */
function fail(message) {
  throw new Error(`${PIN_FILE}: ${message}`);
}

/**
 * Tells whether a value is a plain JSON object.
 * @param {unknown} value - Parsed JSON value.
 * @returns {value is Record<string, unknown>} True for a non-null, non-array object.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns a string field that matches its pattern, or fails.
 * @param {unknown} value - Field value from the pin.
 * @param {RegExp} pattern - Required shape.
 * @param {string} field - Field path for the error.
 * @returns {string} The validated value.
 */
function requireMatch(value, pattern, field) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail(`${field} must match ${pattern}, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Validates the download URL of one asset.
 * @param {string} key - Asset platform key, e.g. lin.x86_64.
 * @param {unknown} url - URL from the pin.
 * @param {string} build - Pinned `<version>-<release>`.
 * @returns {string} The validated URL.
 */
function requireAssetUrl(key, url, build) {
  if (typeof url !== 'string' || !url.startsWith(DOWNLOAD_PREFIX) || new URL(url).href !== url) {
    fail(`assets.${key}.url must be a canonical URL under ${DOWNLOAD_PREFIX}`);
  }
  const fileName = url.slice(url.lastIndexOf('/') + 1);
  const expected = `camoufox-${build}-${key}.zip`;
  if (fileName !== expected) {
    fail(`assets.${key}.url must download ${expected}, got ${fileName}`);
  }
  return url;
}

/**
 * Validates one pinned asset.
 * @param {string} key - Asset platform key, e.g. lin.x86_64.
 * @param {unknown} raw - Asset entry from the pin.
 * @param {string} build - Pinned `<version>-<release>`.
 * @returns {{ url: string, sha256: string }} The validated asset.
 */
function parseAsset(key, raw, build) {
  if (!SUPPORTED_ASSET_KEYS.has(key)) {
    fail(`assets key ${key} is not a platform camoufox-js can run`);
  }
  if (!isRecord(raw)) fail(`assets.${key} must be an object`);
  return {
    url: requireAssetUrl(key, raw.url, build),
    sha256: requireMatch(raw.sha256, SHA256_PATTERN, `assets.${key}.sha256`),
  };
}

/**
 * Validates a parsed pin file.
 * @param {unknown} raw - Parsed contents of config/camoufox-pin.json.
 * @returns {import('./camoufox-pin-logic.d.mts').ICamoufoxPin} The validated pin.
 */
export function parsePin(raw) {
  if (!isRecord(raw)) fail('must be a JSON object');
  const version = requireMatch(raw.version, VERSION_PATTERN, 'version');
  const release = requireMatch(raw.release, RELEASE_PATTERN, 'release');
  if (!isRecord(raw.assets) || Object.keys(raw.assets).length === 0) {
    fail('assets must pin at least one platform');
  }
  const build = `${version}-${release}`;
  const assets = Object.fromEntries(
    Object.entries(raw.assets).map(([key, asset]) => [key, parseAsset(key, asset, build)]),
  );
  return { version, release, assets };
}

/**
 * Names the Camoufox asset platform for a Node platform and architecture.
 * @param {string} platform - Node `process.platform`.
 * @param {string} arch - Node `process.arch`.
 * @returns {string} Asset platform key, e.g. lin.x86_64.
 */
export function assetKeyFor(platform, arch) {
  const key = `${OS_KEYS.get(platform)}.${ARCH_KEYS.get(arch)}`;
  if (!SUPPORTED_ASSET_KEYS.has(key)) {
    throw new Error(`Camoufox has no build for ${platform}/${arch} (see ${PIN_FILE})`);
  }
  return key;
}

/**
 * Picks the pinned asset for a Node platform and architecture.
 * @param {import('./camoufox-pin-logic.d.mts').ICamoufoxPin} pin - Validated pin.
 * @param {string} platform - Node `process.platform`.
 * @param {string} arch - Node `process.arch`.
 * @returns {import('./camoufox-pin-logic.d.mts').ISelectedAsset} The asset and its key.
 */
export function selectAsset(pin, platform, arch) {
  const key = assetKeyFor(platform, arch);
  if (!Object.hasOwn(pin.assets, key)) {
    throw new Error(`${PIN_FILE} pins no Camoufox asset for ${key}`);
  }
  const { url, sha256 } = pin.assets[key];
  return { key, url, sha256 };
}

/**
 * Tells whether an installed version.json records the pinned build.
 * @param {import('./camoufox-pin-logic.d.mts').ICamoufoxPin} pin - Validated pin.
 * @param {unknown} installed - Parsed version.json, or undefined when absent.
 * @returns {boolean} True only for the pinned version and release.
 */
export function matchesPin(pin, installed) {
  return (
    isRecord(installed) && installed.version === pin.version && installed.release === pin.release
  );
}

/**
 * Tells whether the installed asset record names the selected asset.
 * @param {import('./camoufox-pin-logic.d.mts').ISelectedAsset} asset - Asset for this platform.
 * @param {unknown} recorded - Parsed INSTALLED_ASSET_FILE, or undefined when absent.
 * @returns {boolean} True only for the same platform key and archive digest.
 */
export function matchesAsset(asset, recorded) {
  return isRecord(recorded) && recorded.key === asset.key && recorded.sha256 === asset.sha256;
}

/**
 * Names the executable camoufox-js launches for an asset platform.
 * @param {string} key - Asset platform key, e.g. lin.x86_64.
 * @returns {string} Path relative to the install directory.
 */
export function launchFileFor(key) {
  const launchFile = SUPPORTED_ASSET_KEYS.has(key) && LAUNCH_FILES.get(key.split('.')[0]);
  if (!launchFile) {
    throw new Error(`camoufox-js cannot launch a ${key} build (see ${PIN_FILE})`);
  }
  return launchFile;
}
