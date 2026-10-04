/**
 * camoufox-js fetcher that installs one pinned, digest-checked Camoufox build.
 *
 * Upstream's CamoufoxFetcher installs whichever build the newest GitHub
 * release carries, unchecked. This subclass replaces only that choice: the
 * build comes from config/camoufox-pin.json, and the downloaded archive must
 * match the pinned SHA-256 before upstream extracts it. Once upstream's install
 * has finished, the asset is recorded beside version.json. Download retries,
 * extraction, version.json, permissions and cleanup on failure stay
 * upstream's. tests/camoufox-pinned-fetcher.test.ts fails when a camoufox-js
 * update changes the hooks this relies on.
 */

import { createHash } from 'node:crypto';
import { createReadStream, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CamoufoxFetcher, INSTALL_DIR } from '@hieutran094/camoufox-js/dist/pkgman.js';

import { INSTALLED_ASSET_FILE, PIN_FILE } from './camoufox-pin-logic.mjs';

/**
 * Hashes a file without loading it into memory.
 * @param {string} file - Path of the downloaded archive.
 * @returns {Promise<string>} Lowercase hex SHA-256.
 */
function sha256Of(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Installs the pinned Camoufox asset through camoufox-js. */
export class PinnedCamoufoxFetcher extends CamoufoxFetcher {
  /** @type {{ key: string, url: string, sha256: string }} */
  #asset;

  /**
   * @param {{ key: string, url: string, sha256: string }} asset - Pinned archive,
   *   its platform key and its digest.
   */
  constructor(asset) {
    super();
    this.#asset = asset;
  }

  /**
   * Resolves the pinned build instead of querying GitHub for the newest one.
   * Upstream's own asset parser reads the version from the file name and
   * rejects an asset for another platform.
   * @returns {Promise<void>} Resolves once url, version and release are set.
   */
  async fetchLatest() {
    const { url } = this.#asset;
    const name = url.slice(url.lastIndexOf('/') + 1);
    const build = this.checkAsset({ name, browser_download_url: url });
    if (!build) {
      throw new Error(`${name} is not a Camoufox build for this platform (see ${PIN_FILE})`);
    }
    [this._version_obj, this._url] = build;
  }

  /**
   * Extracts the downloaded archive only when its digest matches the pin.
   * @param {string} zipFile - Path of the downloaded archive.
   * @returns {Promise<void>} Resolves once upstream has extracted it.
   */
  async extractZip(zipFile) {
    const actual = await sha256Of(zipFile);
    if (actual !== this.#asset.sha256) {
      throw new Error(
        `Camoufox archive digest mismatch: expected ${this.#asset.sha256}, got ${actual} (see ${PIN_FILE})`,
      );
    }
    await super.extractZip(zipFile);
  }

  /**
   * Installs through upstream, then records the installed asset. The record
   * is the last write, so an install stopped at any earlier step, permissions
   * included, has no record and is installed again; a torn write is not
   * valid JSON, so it reads as no record too. If the record cannot be
   * written, the install is removed, as upstream does for its own failures.
   * @returns {Promise<void>} Resolves once the build and its record are installed.
   */
  async install() {
    await super.install();
    const { key, sha256 } = this.#asset;
    try {
      writeFileSync(join(String(INSTALL_DIR), INSTALLED_ASSET_FILE), JSON.stringify({ key, sha256 }));
    } catch (error) {
      CamoufoxFetcher.cleanup();
      throw error;
    }
  }
}
