/**
 * CamoufoxFontGuard tests — pins the startup check that stops a container
 * whose CAMOUFOX_OS selects a font set the bundled browser does not ship.
 *
 * Camoufox launches without complaint when its OS fonts are missing and then
 * fingerprints with fallback fonts, so a misconfiguration would surface only
 * as unexplained bank-side detection. Each case lays out a real install tree
 * and checks the guard reads it exactly as the scraper and camoufox-js do.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import checkCamoufoxFonts from '../../src/Scraper/CamoufoxFontGuard.js';

type Env = Record<string, string | undefined>;

describe('checkCamoufoxFonts', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'camoufox-fonts-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  /**
   * Creates font directories for the given OSes under an install directory.
   * @param installDir - Camoufox install directory.
   * @param oses - OS font sets to create.
   * @returns The install's fonts directory.
   */
  function installFonts(installDir: string, oses: readonly string[]): string {
    const fontsDir = join(installDir, 'fonts');
    mkdirSync(fontsDir, { recursive: true });
    for (const os of oses) mkdirSync(join(fontsDir, os));
    return fontsDir;
  }

  /**
   * Runs the guard on Linux against the temp home.
   * @param env - Environment the guard sees.
   * @returns The guard result.
   */
  function check(env: Env): ReturnType<typeof checkCamoufoxFonts> {
    return checkCamoufoxFonts({ env, homeDir: home, platform: 'linux' });
  }

  /**
   * Returns the failure message, failing the test when the guard passed.
   * @param env - Environment the guard sees.
   * @returns The failure message.
   */
  function failureOf(env: Env): string {
    const result = check(env);
    if (result.success) throw new Error(`guard passed with os=${result.data.os}`);
    return result.message;
  }

  describe('with only the Windows fonts installed', () => {
    let fontsDir: string;

    beforeEach(() => {
      fontsDir = installFonts(join(home, '.cache', 'camoufox'), ['windows']);
    });

    it.each<[string, Env]>([
      ['unset', {}],
      ['windows', { CAMOUFOX_OS: 'windows' }],
      ['WINDOWS', { CAMOUFOX_OS: 'WINDOWS' }],
      ['empty', { CAMOUFOX_OS: '' }],
      ['untrimmed " linux"', { CAMOUFOX_OS: ' linux' }],
      ['unknown "solaris"', { CAMOUFOX_OS: 'solaris' }],
    ])('passes with the Windows fingerprint when CAMOUFOX_OS is %s', (_label, env) => {
      const result = check(env);

      expect(result.success).toBe(true);
      expect(result.success && result.data.os).toBe('windows');
    });

    it.each(['linux', 'Linux', 'LINUX'])('rejects %s, resolved case-insensitively like the scraper', (raw) => {
      const message = failureOf({ CAMOUFOX_OS: raw });

      expect(message).toBe(
        `Camoufox font check failed: CAMOUFOX_OS=${raw} selects the linux fingerprint, but ${fontsDir} has no linux fonts. `
        + 'Unset CAMOUFOX_OS or set it to one of: windows.');
    });

    it('rejects the pruned macOS fingerprint and names the font sets that remain', () => {
      const message = failureOf({ CAMOUFOX_OS: 'macos' });

      expect(message).toContain('selects the macos fingerprint');
      expect(message.endsWith('set it to one of: windows.')).toBe(true);
    });

    it('does not count a regular file named like an OS as an installed font set', () => {
      writeFileSync(join(fontsDir, 'linux'), '');

      const message = failureOf({ CAMOUFOX_OS: 'linux' });

      expect(message).toContain('has no linux fonts');
      expect(message.endsWith('one of: windows.')).toBe(true);
    });
  });

  it('lists every remaining font set, sorted', () => {
    installFonts(join(home, '.cache', 'camoufox'), ['windows', 'linux']);

    expect(failureOf({ CAMOUFOX_OS: 'macos' }).endsWith('one of: linux, windows.')).toBe(true);
  });

  it('asks for a reinstall when the fonts directory holds no OS set, naming an unset value plainly', () => {
    const fontsDir = installFonts(join(home, '.cache', 'camoufox'), []);

    const message = failureOf({});

    expect(message).toBe(
      `Camoufox font check failed: CAMOUFOX_OS=(unset) selects the windows fingerprint, but ${fontsDir} has no fonts `
      + 'for any OS. Reinstall the pinned Camoufox build.');
    expect(message).not.toContain('undefined');
  });

  it('leaves startup unchanged when no browser is installed', () => {
    expect(check({ CAMOUFOX_OS: 'linux' }).success).toBe(true);
  });

  it.skipIf(process.getuid?.() === 0)('leaves startup unchanged when the install cannot be read', () => {
    const installDir = join(home, '.cache', 'camoufox');
    installFonts(installDir, ['windows']);
    chmodSync(installDir, 0o000);

    try {
      expect(check({ CAMOUFOX_OS: 'linux' }).success).toBe(true);
    } finally {
      chmodSync(installDir, 0o755);
    }
  });

  it('checks CAMOUFOX_INSTALL_DIR instead of the home cache when it is set', () => {
    installFonts(join(home, '.cache', 'camoufox'), ['windows', 'macos', 'linux']);
    const fontsDir = installFonts(join(home, 'custom'), ['windows']);

    const message = failureOf({ CAMOUFOX_OS: 'linux', CAMOUFOX_INSTALL_DIR: join(home, 'custom') });

    expect(message).toContain(`but ${fontsDir} has no linux fonts`);
  });

  it('does not check the install off Linux, where the browser keeps its fonts elsewhere', () => {
    installFonts(join(home, '.cache', 'camoufox'), ['windows']);

    const result = checkCamoufoxFonts({ env: { CAMOUFOX_OS: 'linux' }, homeDir: home, platform: 'darwin' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.os).toBe('linux');
  });

  describe('called with no input, as the entry points do', () => {
    const original = { os: process.env.CAMOUFOX_OS, dir: process.env.CAMOUFOX_INSTALL_DIR };

    afterEach(() => {
      if (original.os === undefined) delete process.env.CAMOUFOX_OS;
      else process.env.CAMOUFOX_OS = original.os;
      if (original.dir === undefined) delete process.env.CAMOUFOX_INSTALL_DIR;
      else process.env.CAMOUFOX_INSTALL_DIR = original.dir;
    });

    it('reads the running process environment and platform', () => {
      installFonts(join(home, 'live'), ['windows']);
      process.env.CAMOUFOX_OS = 'linux';
      process.env.CAMOUFOX_INSTALL_DIR = join(home, 'live');

      const result = checkCamoufoxFonts();
      const outcome = result.success ? result.data.os : result.message;

      expect(result.success).toBe(process.platform !== 'linux');
      expect(outcome).toContain('linux');
      expect(result.success || outcome.includes(join(home, 'live', 'fonts'))).toBe(true);
    });
  });
});
