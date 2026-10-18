/**
 * Published image contents E2E.
 *
 * The image is built in two stages so that Camoufox ships once, with only the
 * Windows fonts its default fingerprint uses, and no build tooling ships at
 * all. These checks run against the built image, so they catch a Dockerfile
 * edit that quietly reintroduces a duplicate Camoufox layer, the unused font
 * sets, devDependencies or a package manager, or that drops a file the
 * runtime needs.
 */

import { execFileSync, spawnSync } from 'child_process';

import { describe, it, expect } from 'vitest';

import { hasDockerImage } from './helpers/dockerRunner.js';

/** Image the E2E job builds before running this suite. */
const DOCKER_IMAGE = 'israeli-bank-importer:e2e';

/** Smallest layer that can hold the Camoufox install, or a copy of it. */
const CAMOUFOX_LAYER_MIN_BYTES = 100_000_000;

/** The install with only the Windows fonts; with every OS font set it is 1.29 GB. */
const CAMOUFOX_LAYER_MAX_BYTES = 700_000_000;

/** Leading text of the startup font check's failure message. */
const FONT_GUARD_PREFIX = 'Camoufox font check failed';

/** Families the Windows fingerprint must render with their own glyphs. */
const RENDERED_FAMILIES = ['Segoe UI', 'Arial', 'Times New Roman'] as const;

/** Owner, group and octal mode of each path from the home directory down to the browser binary. */
const INSTALL_OWNERSHIP: Readonly<Record<string, string>> = {
  '/home/node': 'node:node 700',
  '/home/node/.cache': 'root:root 755',
  '/home/node/.cache/camoufox': 'node:node 755',
  '/home/node/.cache/camoufox/camoufox-bin': 'node:node 755',
};

/** Shell the shell-form HEALTHCHECK runs through. */
const EXPECTED_SHELL = ['/bin/bash', '-o', 'pipefail', '-c'];

/**
 * Launches the shipped Camoufox with the scraper's default OS fingerprint and
 * reports the OS user it ran as, the platform the page saw, and canvas text
 * widths for a few Windows families and an unknown one. Both fall back to
 * monospace, so a family renders at the fallback width only when it is
 * missing. Widths are compared within this one launch: Camoufox seeds its
 * font metrics per launch.
 */
const CAMOUFOX_LAUNCH = `
import { userInfo } from 'node:os';
import { Camoufox } from '@hieutran094/camoufox-js';
const browser = await Camoufox({ headless: true, os: 'windows' });
const page = await browser.newPage();
const platform = await page.evaluate(() => navigator.platform);
const widths = await page.evaluate((families) => {
  const context = document.createElement('canvas').getContext('2d');
  const measure = (family) => {
    context.font = '48px "' + family + '", monospace';
    return context.measureText('mmmmmmmmmmlli1WQ@#').width;
  };
  return Object.fromEntries([...families, 'No Such Font Zz'].map((family) => [family, measure(family)]));
}, ${JSON.stringify(RENDERED_FAMILIES)});
await browser.close();
process.stdout.write(JSON.stringify({ user: userInfo().username, platform, widths }));
`;

/**
 * Lists the fonts Camoufox's Windows fontconfig exposes and reports which
 * families of camoufox-js's Windows allowlist are not among them, and any
 * listed font file outside the install's own fonts.
 */
const FONT_COVERAGE = `
import { execFileSync } from 'node:child_process';
const { default: mappings } = await import('@hieutran094/camoufox-js/dist/mappings/fonts.config.js');
const install = '/home/node/.cache/camoufox';
const env = { ...process.env, FONTCONFIG_PATH: install + '/fontconfig/windows', XDG_CACHE_HOME: '/tmp/fc' };
const listed = execFileSync('fc-list', ['-f', '%{family}\\t%{file}\\n'], { cwd: install, env, encoding: 'utf8' })
  .split('\\n').filter(Boolean).map((line) => line.split('\\t'));
const families = new Set(listed.flatMap(([family]) => family.split(',').map((name) => name.trim().toLowerCase())));
process.stdout.write(JSON.stringify({
  allowed: mappings.win.length,
  missing: mappings.win.filter((name) => !families.has(name.toLowerCase())),
  outside: listed.map(([, file]) => file).filter((file) => !file.startsWith(install + '/fonts/')),
}));
`;

/** Reports which OS font sets the Camoufox install ships. */
const FONT_SETS = `
import { existsSync } from 'node:fs';
const fonts = '/home/node/.cache/camoufox/fonts';
process.stdout.write(JSON.stringify(['windows', 'macos', 'linux'].filter((os) => existsSync(fonts + '/' + os))));
`;

/** Builds a scraper through the public API and reports whether it can scrape. */
const SCRAPER_API = `
import { createScraper } from '@sergienko4/israeli-bank-scrapers';
const scraper = createScraper({ companyId: 'hapoalim', startDate: new Date() });
process.stdout.write(typeof scraper.scrape);
`;

/** Opens and closes an in-memory database through the native module. */
const SQLITE_OPEN = `
import Database from 'better-sqlite3';
const db = new Database(':memory:');
db.close();
process.stdout.write('ok');
`;

/** What the shipped Camoufox launch reports. */
interface ILaunchReport {
  readonly user: string;
  readonly platform: string;
  readonly widths: Readonly<Record<string, number>>;
}

/** What the font coverage probe reports. */
interface IFontCoverage {
  readonly allowed: number;
  readonly missing: readonly string[];
  readonly outside: readonly string[];
}

/** Exit status and output of a container run to completion. */
interface IContainerExit {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs a docker CLI command and returns its output.
 * @param args - Arguments passed to the docker CLI.
 * @param timeoutMs - Upper bound for the command.
 * @returns Trimmed stdout of the command.
 */
function docker(args: readonly string[], timeoutMs = 30_000): string {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: timeoutMs, stdio: 'pipe' }).trim();
}

/**
 * Runs a command inside a fresh container of the image as its default user.
 * @param entrypoint - Executable that replaces the image entrypoint.
 * @param args - Arguments passed to the entrypoint.
 * @returns Trimmed stdout of the command.
 */
function runInImage(entrypoint: string, args: readonly string[]): string {
  return docker(['run', '--rm', '--entrypoint', entrypoint, DOCKER_IMAGE, ...args], 150_000);
}

/**
 * Runs the image's own command, or the given one, with CAMOUFOX_OS set, and
 * returns how it exited whatever the status.
 * @param camoufoxOs - Value of CAMOUFOX_OS in the container.
 * @param command - Command replacing the image CMD; the CMD when empty.
 * @returns Exit status and output.
 */
function runWithCamoufoxOs(camoufoxOs: string, command: readonly string[]): IContainerExit {
  const args = ['run', '--rm', '-e', `CAMOUFOX_OS=${camoufoxOs}`, DOCKER_IMAGE, ...command];
  const run = spawnSync('docker', args, { encoding: 'utf8', timeout: 60_000 });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe.runIf(hasDockerImage())('published image contents E2E', () => {
  it('ships Camoufox in exactly one layer, without the unused font sets', () => {
    const history = docker(['history', '--no-trunc', '--human=false', '--format', '{{.Size}}\t{{.CreatedBy}}', DOCKER_IMAGE]);
    const layers = history.split('\n').map((line) => line.split('\t'));

    const camoufoxLayers = layers.filter(
      ([size, createdBy]) => Number(size) >= CAMOUFOX_LAYER_MIN_BYTES && (createdBy ?? '').includes('camoufox'));

    expect(camoufoxLayers).toHaveLength(1);
    expect(Number(camoufoxLayers[0]?.[0])).toBeLessThanOrEqual(CAMOUFOX_LAYER_MAX_BYTES);
  });

  it('ships only the Windows font set', () => {
    const sets: unknown = JSON.parse(runInImage('node', ['--input-type=module', '-e', FONT_SETS]));

    expect(sets).toEqual(['windows']);
  });

  it('covers the whole Windows font allowlist from the install alone', () => {
    const coverage = JSON.parse(runInImage('node', ['--input-type=module', '-e', FONT_COVERAGE])) as IFontCoverage;

    expect(coverage.allowed).toBeGreaterThan(0);
    expect(coverage.missing).toEqual([]);
    expect(coverage.outside).toEqual([]);
  });

  it('keeps the owners and modes from the home directory down to the browser binary', () => {
    const stats = runInImage('stat', ['-c', '%n\t%U:%G %a', ...Object.keys(INSTALL_OWNERSHIP)]);
    const ownership = Object.fromEntries(stats.split('\n').map((line) => line.split('\t')));

    expect(ownership).toEqual(INSTALL_OWNERSHIP);
  });

  it('stamps every Camoufox layer entry with the epoch, so the layer rebuilds byte-identical', () => {
    const newer = runInImage('bash', [
      '-c',
      'find /home /home/node -maxdepth 0 -newermt @0 && find /home/node/.cache -newermt @0',
    ]);

    expect(newer).toBe('');
  });

  it('runs the health check through bash with pipefail', () => {
    const inspected = docker(['image', 'inspect', '--format', '{{json .Config.Shell}}', DOCKER_IMAGE]);
    const shell: unknown = JSON.parse(inspected);

    expect(shell).toEqual(EXPECTED_SHELL);
  });

  it('ships no devDependencies', () => {
    const resolved = runInImage('node', [
      '-e',
      'try { require.resolve("vitest"); process.stdout.write("present"); } catch { process.stdout.write("absent"); }',
    ]);

    expect(resolved).toBe('absent');
  });

  it('ships no package manager on PATH', () => {
    const found = runInImage('bash', ['-c', 'command -v npm npx corepack yarn yarnpkg || true']);

    expect(found).toBe('');
  });

  it('ships the config portal assets the server falls back to', () => {
    const present = runInImage('node', [
      '-e',
      'process.stdout.write(String(require("fs").existsSync("/app/src/Portal/Public/index.html")))',
    ]);

    expect(present).toBe('true');
  });

  it('launches the shipped Camoufox headless as the node user, rendering Windows fonts', () => {
    const launch = JSON.parse(runInImage('node', ['--input-type=module', '-e', CAMOUFOX_LAUNCH])) as ILaunchReport;
    const { widths, ...identity } = launch;
    const fallback = widths['No Such Font Zz'];

    expect(identity).toEqual({ user: 'node', platform: 'Win32' });
    expect(fallback).toBeGreaterThan(0);
    for (const family of RENDERED_FAMILIES) expect(widths[family], family).not.toBe(fallback);
  }, 180_000);

  it('stops the importer when CAMOUFOX_OS selects a font set the image does not ship', () => {
    const run = runWithCamoufoxOs('linux', ['node', 'dist/Index.js']);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`${FONT_GUARD_PREFIX}: CAMOUFOX_OS=linux selects the linux fingerprint`);
  }, 90_000);

  it('stops the default scheduler when CAMOUFOX_OS selects a font set the image does not ship', () => {
    const run = runWithCamoufoxOs('macos', []);

    expect(run.status).toBe(1);
    expect(run.stdout + run.stderr).toContain(`${FONT_GUARD_PREFIX}: CAMOUFOX_OS=macos selects the macos fingerprint`);
  }, 90_000);

  it('lets the importer past the font check for the Windows fingerprint in any case', () => {
    const run = runWithCamoufoxOs('WINDOWS', ['node', 'dist/Index.js']);

    expect(run.stdout + run.stderr).not.toContain(FONT_GUARD_PREFIX);
    // With no config in the container, the config load that follows the check is what fails.
    expect(run.stderr).toMatch(/^Fatal: /mu);
  }, 90_000);

  it('exposes the scraper API', () => {
    const scrapeType = runInImage('node', ['--input-type=module', '-e', SCRAPER_API]);

    expect(scrapeType).toBe('function');
  });

  it('loads the better-sqlite3 native module', () => {
    const opened = runInImage('node', ['--input-type=module', '-e', SQLITE_OPEN]);

    expect(opened).toBe('ok');
  });
});
