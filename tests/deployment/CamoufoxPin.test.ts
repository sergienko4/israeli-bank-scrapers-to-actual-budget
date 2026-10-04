/**
 * Guards the Camoufox browser pin.
 *
 * Every image, CI run and local install used to download whichever Camoufox
 * build upstream published last. Upstream v156.0.1-beta.34 dropped config
 * properties that camoufox-js still sets on every launch, so every browser
 * launch threw `UnknownProperty` and CI on main went red overnight with no
 * change in this repository. One file, config/camoufox-pin.json, now decides
 * the build, and every install site goes through scripts/camoufox-fetch.mjs,
 * which checks the archive digest. These checks fail as soon as a build site
 * fetches an unpinned binary again.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  INSTALLED_ASSET_FILE,
  launchFileFor,
  parsePin,
  selectAsset,
} from '../../scripts/camoufox-pin-logic.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const INSTALLER = 'scripts/camoufox-fetch.mjs';
const PIN_FILE = 'config/camoufox-pin.json';
const CACHE_ACTION = '.github/actions/docker/camoufox-cache/action.yml';

/** Commands that download whatever Camoufox build upstream published last. */
const UNPINNED_FETCH =
  /camoufox-js\s+fetch|gh\s+release\s+download[^\n]*daijro\/camoufox|daijro\/camoufox\/releases\/latest/;

/** Fields of a composite-action step this suite reads. */
interface IActionStep {
  readonly id?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Readonly<Record<string, string>>;
}

/**
 * Reads a repository file.
 * @param relativePath - Path from the repository root.
 * @returns The file text.
 */
function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

/**
 * Lists every workflow and composite-action file under .github.
 * @returns Repository-relative YAML paths.
 */
function githubYamlFiles(): string[] {
  return readdirSync(join(ROOT, '.github'), { encoding: 'utf8', recursive: true })
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => join('.github', file));
}

/**
 * Lists the installer modules the Docker build must copy.
 * @returns Repository-relative paths of scripts/camoufox-*.mjs.
 */
function installerModules(): string[] {
  return readdirSync(join(ROOT, 'scripts'))
    .filter((file) => /^camoufox-.+\.mjs$/.test(file))
    .map((file) => `scripts/${file}`);
}

/**
 * Reads the steps of the CI Camoufox cache action.
 * @returns The composite action steps.
 */
function cacheActionSteps(): IActionStep[] {
  const action = parse(read(CACHE_ACTION)) as { runs: { steps: IActionStep[] } };
  return action.runs.steps;
}

/**
 * Reads the actions/cache step of the CI Camoufox cache action.
 * @returns The cache step's inputs.
 */
function cacheInputs(): Readonly<Record<string, string>> {
  const step = cacheActionSteps().find((candidate) => candidate.uses?.startsWith('actions/cache'));
  return step?.with ?? {};
}

/**
 * Runs the cache action's check step in this checkout the way a composite
 * `shell: bash` step runs.
 * @param home - HOME, whose .cache/camoufox the step inspects.
 * @returns The step outputs it wrote.
 */
function runCheckStep(home: string): string {
  const script = cacheActionSteps().find((step) => step.id === 'check')?.run ?? 'exit 99';
  const outputFile = join(home, 'github-output');
  writeFileSync(outputFile, '');
  spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, GITHUB_OUTPUT: outputFile, CAMOUFOX_INSTALL_DIR: '' },
    timeout: 10_000,
  });
  return readFileSync(outputFile, 'utf8');
}

describe('Camoufox install sites', () => {
  it('no build file downloads an unpinned Camoufox build', () => {
    const files = ['Dockerfile', 'package.json', ...githubYamlFiles()];

    const offenders = files.filter((file) => UNPINNED_FETCH.test(read(file)));

    expect(offenders).toEqual([]);
  });

  it('camoufox:install runs the pinned installer', () => {
    const manifest = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

    expect(manifest.scripts['camoufox:install']).toBe(`node ${INSTALLER}`);
  });
});

describe('Dockerfile Camoufox step', () => {
  const lines = read('Dockerfile').split('\n');
  const installLine = lines.findIndex(
    (line) => line.includes(`node ${INSTALLER}`) && !line.includes('--verify'),
  );
  const verifyLine = lines.findIndex((line) => line.includes(`node ${INSTALLER} --verify`));
  const precacheLine = lines.findIndex((line) => line.includes('cp -r /tmp/camoufox-precache/'));

  it('installs through the pinned installer when no precached binary is used', () => {
    expect(installLine).toBeGreaterThanOrEqual(0);
  });

  it('verifies the pin after both the precache and the install path', () => {
    const verifiedAfter = [precacheLine, installLine].map((line) => line >= 0 && line < verifyLine);

    expect(verifiedAfter).toEqual([true, true]);
  });

  it('copies the pin and every installer module before installing', () => {
    const required = [PIN_FILE, ...installerModules()];

    const notCopiedInTime = required.filter((file) => {
      const copyLine = lines.findIndex(
        (line) => /^COPY\s/.test(line) && line.split(/\s+/).includes(file),
      );
      return copyLine < 0 || installLine < 0 || copyLine > installLine;
    });

    expect(notCopiedInTime).toEqual([]);
  });
});

describe('CI Camoufox cache action', () => {
  it('keys the cache on the pin, the installer and the runner architecture', () => {
    const key = cacheInputs().key ?? '';
    const hashed = /hashFiles\(([^)]*)\)/.exec(key)?.[1] ?? '';

    expect({
      pin: hashed.includes(`'${PIN_FILE}'`),
      installer: hashed.includes("'scripts/camoufox-*.mjs'"),
      arch: key.includes('runner.arch'),
    }).toEqual({ pin: true, installer: true, arch: true });
  });

  it('never restores a cache saved under another key', () => {
    expect(cacheInputs()['restore-keys']).toBeUndefined();
  });

  it('installs through the pinned installer', () => {
    const scripts = cacheActionSteps().map((step) => step.run ?? '').join('\n');

    expect(scripts).toContain(`node ${INSTALLER}`);
  });
});

describe('committed Camoufox pin', () => {
  it('passes the pin schema', async () => {
    const { parsePin } = await import('../../scripts/camoufox-pin-logic.mjs');

    expect(() => parsePin(JSON.parse(read(PIN_FILE)))).not.toThrow();
  });

  it('covers both platforms the image is published for', () => {
    const pin = JSON.parse(read(PIN_FILE)) as { assets: Record<string, unknown> };

    expect(Object.keys(pin.assets)).toEqual(expect.arrayContaining(['lin.x86_64', 'lin.arm64']));
  });

  it('covers the developer platforms camoufox:install supported before the pin', () => {
    const pin = JSON.parse(read(PIN_FILE)) as { assets: Record<string, unknown> };

    expect(Object.keys(pin.assets)).toEqual(
      expect.arrayContaining(['mac.arm64', 'mac.x86_64', 'win.x86_64', 'win.i686']),
    );
  });
});

describe('CI Camoufox cache action check step', () => {
  let workDir = '';

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'camoufox-action-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  /**
   * Lays out a cached install of the pinned build in workDir's HOME; like
   * upstream's install, the browser executable is mode 755.
   * @returns Path of the browser executable.
   */
  function cachePinnedBuild(): string {
    const pin = parsePin(JSON.parse(read(PIN_FILE)));
    const asset = selectAsset(pin, process.platform, process.arch);
    const cacheDir = join(workDir, '.cache', 'camoufox');
    const launchFile = join(cacheDir, launchFileFor(asset.key));
    mkdirSync(dirname(launchFile), { recursive: true });
    writeFileSync(launchFile, 'cached binary', { mode: 0o755 });
    writeFileSync(
      join(cacheDir, 'version.json'),
      JSON.stringify({ version: pin.version, release: pin.release }),
    );
    writeFileSync(
      join(cacheDir, INSTALLED_ASSET_FILE),
      JSON.stringify({ key: asset.key, sha256: asset.sha256 }),
    );
    return launchFile;
  }

  it('reports a cached pinned build as installed', () => {
    cachePinnedBuild();

    const outputs = runCheckStep(workDir);

    expect(outputs).toContain('installed=true');
  });

  it.skipIf(process.platform === 'win32')(
    'reports a cached build whose browser cannot be run as not installed',
    () => {
      chmodSync(cachePinnedBuild(), 0o644);

      const outputs = runCheckStep(workDir);

      expect(outputs).toContain('installed=false');
    },
  );
});
