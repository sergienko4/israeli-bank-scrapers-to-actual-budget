/**
 * Contract between the pinned installer and the installed camoufox-js.
 *
 * PinnedCamoufoxFetcher keeps upstream's download, extraction, version.json
 * and cleanup, and replaces only how the build is chosen, adding a digest
 * check before extraction. Those hooks lean on camoufox-js internals, so a
 * camoufox-js bump that changes them must fail here rather than in a release.
 * The archive is served from a local server: no test reaches GitHub.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { assetKeyFor, INSTALLED_ASSET_FILE } from '../scripts/camoufox-pin-logic.mjs';
import { buildStoredZip } from './helpers/storedZip.js';

type FetcherModule = typeof import('../scripts/camoufox-pinned-fetcher.mjs');

const VERSION = '152.0.4';
const RELEASE = 'beta.31';
const PLATFORM_KEY = assetKeyFor(process.platform, process.arch);
const OTHER_PLATFORM_KEY = PLATFORM_KEY === 'lin.x86_64' ? 'mac.arm64' : 'lin.x86_64';
const BINARY_TEXT = '#!/bin/sh\necho camoufox\n';
const ARCHIVE = buildStoredZip([{ name: 'camoufox-bin', content: BINARY_TEXT }]);
const ARCHIVE_SHA256 = createHash('sha256').update(ARCHIVE).digest('hex');
const OTHER_SHA256 = createHash('sha256').update('a different archive').digest('hex');
const NOT_A_ZIP = Buffer.from('these bytes are not a zip archive');
const NOT_A_ZIP_PATH = '/not-a-zip';

/**
 * Names an asset the way the daijro/camoufox releases do.
 * @param platformKey - Asset platform suffix, e.g. lin.x86_64.
 * @returns The release asset file name.
 */
function assetName(platformKey: string): string {
  return `camoufox-${VERSION}-${RELEASE}-${platformKey}.zip`;
}

describe('PinnedCamoufoxFetcher', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'camoufox-contract-'));
  const installDir = join(workDir, 'install');
  const previousInstallDir = process.env.CAMOUFOX_INSTALL_DIR;
  let server: Server | undefined;
  let baseUrl = '';
  let fetcherModule: FetcherModule | undefined;

  /**
   * Creates a fetcher pinned to an asset on the local server.
   * @param platformKey - Platform suffix of the served asset.
   * @param sha256 - Digest the fetcher must enforce.
   * @param directory - Server path the asset is served under.
   * @returns A fetcher that has not resolved its build yet.
   */
  function pinnedFetcher(
    platformKey: string,
    sha256: string,
    directory = '',
  ): InstanceType<FetcherModule['PinnedCamoufoxFetcher']> {
    if (!fetcherModule) throw new Error('fetcher module not loaded');
    const url = `${baseUrl}${directory}/${assetName(platformKey)}`;
    return new fetcherModule.PinnedCamoufoxFetcher({ key: platformKey, url, sha256 });
  }

  /**
   * Installs with a chmod on PATH that runs a shell snippet against the install
   * directory first, then the real chmod. Upstream runs `chmod -R 755 <dir>`
   * after writing version.json, so the snippet sees the install at that step.
   * @param snippet - Shell commands; `$3` is the install directory.
   * @returns Resolves or rejects as the install does.
   */
  async function installWithChmodHook(snippet: string): Promise<void> {
    const realChmod = execFileSync('sh', ['-c', 'command -v chmod'], { encoding: 'utf8' }).trim();
    const fakeBin = join(workDir, 'fake-bin');
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(join(fakeBin, 'chmod'), `#!/bin/sh\n${snippet}\nexec '${realChmod}' "$@"\n`, {
      mode: 0o755,
    });
    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}${delimiter}${previousPath ?? ''}`;
    try {
      await pinnedFetcher(PLATFORM_KEY, ARCHIVE_SHA256).install();
    } finally {
      process.env.PATH = previousPath;
    }
  }

  beforeAll(async () => {
    // camoufox-js reads CAMOUFOX_INSTALL_DIR once, when it is first imported.
    process.env.CAMOUFOX_INSTALL_DIR = installDir;
    fetcherModule = await import('../scripts/camoufox-pinned-fetcher.mjs');
    const served = new Map([
      [`/${assetName(PLATFORM_KEY)}`, ARCHIVE],
      [`${NOT_A_ZIP_PATH}/${assetName(PLATFORM_KEY)}`, NOT_A_ZIP],
    ]);
    server = createServer((request, response) => {
      const body = served.get(request.url ?? '');
      response.writeHead(body ? 200 : 404, { 'content-length': body?.length ?? 0 });
      response.end(body);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    rmSync(installDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    server?.close();
    if (server) await once(server, 'close');
    rmSync(workDir, { recursive: true, force: true });
    if (previousInstallDir === undefined) delete process.env.CAMOUFOX_INSTALL_DIR;
    else process.env.CAMOUFOX_INSTALL_DIR = previousInstallDir;
  });

  it('resolves the pinned build without listing GitHub releases', async () => {
    const fetcher = pinnedFetcher(PLATFORM_KEY, ARCHIVE_SHA256);

    await fetcher.fetchLatest();

    expect({ url: fetcher.url, version: fetcher.version, release: fetcher.release }).toEqual({
      url: `${baseUrl}/${assetName(PLATFORM_KEY)}`,
      version: VERSION,
      release: RELEASE,
    });
  });

  it('refuses an asset built for another platform', async () => {
    const fetcher = pinnedFetcher(OTHER_PLATFORM_KEY, ARCHIVE_SHA256);

    await expect(fetcher.fetchLatest()).rejects.toThrow(assetName(OTHER_PLATFORM_KEY));
  });

  it('installs the archive and records the pinned build in version.json', async () => {
    const fetcher = pinnedFetcher(PLATFORM_KEY, ARCHIVE_SHA256);

    await fetcher.install();

    expect({
      manifest: JSON.parse(readFileSync(join(installDir, 'version.json'), 'utf8')) as unknown,
      binary: readFileSync(join(installDir, 'camoufox-bin'), 'utf8'),
    }).toEqual({ manifest: { version: VERSION, release: RELEASE }, binary: BINARY_TEXT });
  });

  it('records the installed asset beside version.json', async () => {
    const fetcher = pinnedFetcher(PLATFORM_KEY, ARCHIVE_SHA256);

    await fetcher.install();

    expect(JSON.parse(readFileSync(join(installDir, INSTALLED_ASSET_FILE), 'utf8'))).toEqual({
      key: PLATFORM_KEY,
      sha256: ARCHIVE_SHA256,
    });
  });

  it.skipIf(process.platform === 'win32')(
    'records the installed asset only after upstream has set permissions',
    async () => {
      // A process killed during upstream's chmod must not leave a record that
      // marks the install complete.
      const listing = join(workDir, 'listing-at-chmod.txt');

      await installWithChmodHook(`ls "$3" > '${listing}'`);

      const atChmod = readFileSync(listing, 'utf8').split('\n');
      expect({
        versionWritten: atChmod.includes('version.json'),
        assetRecorded: atChmod.includes(INSTALLED_ASSET_FILE),
        recordedAfterInstall: existsSync(join(installDir, INSTALLED_ASSET_FILE)),
      }).toEqual({ versionWritten: true, assetRecorded: false, recordedAfterInstall: true });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'leaves nothing installed when the asset record cannot be written',
    async () => {
      // A directory where the record goes makes the final write fail.
      const install = installWithChmodHook(`mkdir "$3/${INSTALLED_ASSET_FILE}"`);

      await expect(install).rejects.toThrow();
      expect(existsSync(installDir)).toBe(false);
    },
  );

  it('checks the digest before extracting the archive', async () => {
    const fetcher = pinnedFetcher(PLATFORM_KEY, OTHER_SHA256, NOT_A_ZIP_PATH);

    await expect(fetcher.install()).rejects.toThrow(/digest mismatch/);
  });

  it('refuses an archive whose digest differs from the pin', async () => {
    const fetcher = pinnedFetcher(PLATFORM_KEY, OTHER_SHA256);

    await expect(fetcher.install()).rejects.toThrow(/digest/);
  });

  it('leaves nothing installed after a digest mismatch', async () => {
    const fetcher = pinnedFetcher(PLATFORM_KEY, OTHER_SHA256);

    await fetcher.install().catch(() => undefined);

    expect({
      manifest: existsSync(join(installDir, 'version.json')),
      binary: existsSync(join(installDir, 'camoufox-bin')),
    }).toEqual({ manifest: false, binary: false });
  });
});
