/**
 * Ambient types for scripts/camoufox-pin-logic.mjs, so TypeScript tests can
 * import it without `any` leaks. Mirrors scripts/release-signal-logic.d.mts.
 */

/** Repository-relative path of the pin file, named in every error. */
export const PIN_FILE: string;

/** File in the install directory recording the installed asset key and digest. */
export const INSTALLED_ASSET_FILE: string;

/** One downloadable Camoufox archive and the digest it must have. */
export interface ICamoufoxAsset {
  readonly url: string;
  readonly sha256: string;
}

/** The pinned asset for one platform, with its platform key. */
export interface ISelectedAsset extends ICamoufoxAsset {
  readonly key: string;
}

/** A validated config/camoufox-pin.json. */
export interface ICamoufoxPin {
  readonly version: string;
  readonly release: string;
  readonly assets: Readonly<Record<string, ICamoufoxAsset>>;
}

/**
 * Validates a parsed pin file.
 * @param raw - Parsed contents of config/camoufox-pin.json.
 * @returns The validated pin; throws an error naming the pin file otherwise.
 */
export function parsePin(raw: unknown): ICamoufoxPin;

/**
 * Names the Camoufox asset platform for a Node platform and architecture.
 * @param platform - Node `process.platform`.
 * @param arch - Node `process.arch`.
 * @returns Asset platform key, e.g. lin.x86_64; throws for unsupported pairs.
 */
export function assetKeyFor(platform: string, arch: string): string;

/**
 * Picks the pinned asset for a Node platform and architecture.
 * @param pin - Validated pin.
 * @param platform - Node `process.platform`.
 * @param arch - Node `process.arch`.
 * @returns The asset and its key; throws when the pin has no asset for it.
 */
export function selectAsset(pin: ICamoufoxPin, platform: string, arch: string): ISelectedAsset;

/**
 * Tells whether an installed version.json records the pinned build.
 * @param pin - Validated pin.
 * @param installed - Parsed version.json, or undefined when absent.
 * @returns True only for the pinned version and release.
 */
export function matchesPin(pin: ICamoufoxPin, installed: unknown): boolean;

/**
 * Tells whether the installed asset record names the selected asset.
 * @param asset - Asset for this platform.
 * @param recorded - Parsed INSTALLED_ASSET_FILE, or undefined when absent.
 * @returns True only for the same platform key and archive digest.
 */
export function matchesAsset(asset: ISelectedAsset, recorded: unknown): boolean;

/**
 * Names the executable camoufox-js launches for an asset platform.
 * @param key - Asset platform key, e.g. lin.x86_64.
 * @returns Path relative to the install directory; throws for unknown keys.
 */
export function launchFileFor(key: string): string;
