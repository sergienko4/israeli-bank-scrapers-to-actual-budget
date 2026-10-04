/**
 * Drives scripts/camoufox-fetch.mjs as CI, the Dockerfile and
 * `npm run camoufox:install` do: a child process pointed at an install
 * directory through CAMOUFOX_INSTALL_DIR. Only paths that never reach the
 * network run here; the download path is covered by
 * camoufox-pinned-fetcher.test.ts against a local server. Each child runs
 * with fetch stubbed out and a time limit, so a regression that starts a
 * download fails fast instead of pulling the real browser from GitHub.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  INSTALLED_ASSET_FILE,
  launchFileFor,
  parsePin,
  selectAsset,
} from '../scripts/camoufox-pin-logic.mjs';

const CLI = fileURLToPath(new URL('../scripts/camoufox-fetch.mjs', import.meta.url));
const PIN_PATH = fileURLToPath(new URL('../config/camoufox-pin.json', import.meta.url));
const PIN = parsePin(JSON.parse(readFileSync(PIN_PATH, 'utf8')));
const ASSET = selectAsset(PIN, process.platform, process.arch);
const OTHER_KEY = Object.keys(PIN.assets).find((key) => key !== ASSET.key) ?? 'lin.arm64';
const NO_NETWORK =
  'data:text/javascript,globalThis.fetch=()=>Promise.reject(new Error("network disabled in tests"))';
const CHILD_TIMEOUT_MS = 10_000;

/**
 * Lays out what a finished install of the pinned build leaves behind.
 * @param installDir - Directory to populate.
 */
function installPinnedBuild(installDir: string): void {
  const launchFile = join(installDir, launchFileFor(ASSET.key));
  mkdirSync(dirname(launchFile), { recursive: true });
  writeFileSync(launchFile, 'installed binary');
  writeFileSync(
    join(installDir, 'version.json'),
    JSON.stringify({ version: PIN.version, release: PIN.release }),
  );
  writeFileSync(
    join(installDir, INSTALLED_ASSET_FILE),
    JSON.stringify({ key: ASSET.key, sha256: ASSET.sha256 }),
  );
}

/**
 * Runs the installer CLI against one install directory, offline.
 * @param installDir - Directory exported as CAMOUFOX_INSTALL_DIR.
 * @param args - Command-line arguments after the script path.
 * @returns The finished child process.
 */
function runCli(installDir: string, args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ['--import', NO_NETWORK, CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CAMOUFOX_INSTALL_DIR: installDir },
    timeout: CHILD_TIMEOUT_MS,
  });
}

describe('camoufox-fetch CLI', () => {
  let installDir = '';

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), 'camoufox-cli-'));
  });

  afterEach(() => {
    rmSync(installDir, { recursive: true, force: true });
  });

  it('--verify exits 0 when the pinned build is installed', () => {
    installPinnedBuild(installDir);

    const result = runCli(installDir, ['--verify']);

    expect(result.status).toBe(0);
  });

  it('--verify exits 1 and names the pin file when another release is installed', () => {
    installPinnedBuild(installDir);
    const other = { version: PIN.version, release: 'beta.34' };
    writeFileSync(join(installDir, 'version.json'), JSON.stringify(other));

    const result = runCli(installDir, ['--verify']);

    expect({ status: result.status, names: result.stderr.includes('config/camoufox-pin.json') })
      .toEqual({ status: 1, names: true });
  });

  it('--verify exits 1 and names the pin file when nothing is installed', () => {
    const result = runCli(installDir, ['--verify']);

    expect({ status: result.status, names: result.stderr.includes('config/camoufox-pin.json') })
      .toEqual({ status: 1, names: true });
  });

  it('--verify exits 1 when the browser executable is missing', () => {
    installPinnedBuild(installDir);
    rmSync(join(installDir, launchFileFor(ASSET.key)));

    const result = runCli(installDir, ['--verify']);

    expect(result.status).toBe(1);
  });

  it("--verify exits 1 when the install recorded another platform's asset", () => {
    installPinnedBuild(installDir);
    const other = { key: OTHER_KEY, sha256: PIN.assets[OTHER_KEY]?.sha256 };
    writeFileSync(join(installDir, INSTALLED_ASSET_FILE), JSON.stringify(other));

    const result = runCli(installDir, ['--verify']);

    expect(result.status).toBe(1);
  });

  it('keeps a matching install instead of downloading it again', () => {
    installPinnedBuild(installDir);
    const launchFile = join(installDir, launchFileFor(ASSET.key));

    const result = runCli(installDir, []);

    expect({ status: result.status, kept: existsSync(launchFile) }).toEqual({
      status: 0,
      kept: true,
    });
  });

  it('exits 1 with usage on an unknown flag', () => {
    const result = runCli(installDir, ['--latest']);

    expect({ status: result.status, usage: result.stderr.includes('Usage') })
      .toEqual({ status: 1, usage: true });
  });
});
