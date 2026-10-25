/**
 * CamoufoxFontGuard tests — pins the startup check that stops a container
 * whose CAMOUFOX_OS selects a font set the bundled browser does not ship.
 *
 * Camoufox launches without complaint when its OS fonts are missing and then
 * fingerprints with fallback fonts, so a misconfiguration would surface only
 * as unexplained bank-side detection. Each case lays out a real install tree,
 * font groups plus the groups.json that maps each OS to the groups it reads,
 * and checks the guard reads it exactly as the scraper and camoufox-js do.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import checkCamoufoxFonts, { type CamoufoxOs } from '../../src/Scraper/CamoufoxFontGuard.js';

type Env = Record<string, string | undefined>;

/** Stand-in font contents: the guard needs a non-empty file, not a parsable font. */
const FONT_BYTES = 'not-a-real-font';

/** groups.json's readBy as the pinned Camoufox build ships it. */
const READ_BY: Readonly<Record<string, readonly string[]>> = {
  lin: ['L', 'LM', 'LMW', 'LW'],
  mac: ['LM', 'LMW', 'M', 'MW'],
  win: ['LMW', 'LW', 'MW', 'W'],
};

/** Key groups.json lists each OS under. */
const OS_KEYS: Readonly<Record<CamoufoxOs, string>> = { linux: 'lin', macos: 'mac', windows: 'win' };

describe('checkCamoufoxFonts', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'camoufox-fonts-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  /**
   * Creates one font group holding one non-empty font file.
   * @param fontsDir - The install's fonts directory.
   * @param group - Group directory name.
   */
  function addGroup(fontsDir: string, group: string): void {
    mkdirSync(join(fontsDir, group));
    writeFileSync(join(fontsDir, group, 'Candara.ttf'), FONT_BYTES);
  }

  /**
   * Lays out an install the way the image prune leaves it: the full
   * groups.json, and only the font groups the given OSes read.
   * @param installDir - Camoufox install directory.
   * @param oses - OSes whose font groups to create.
   * @returns The install's fonts directory.
   */
  function installFonts(installDir: string, oses: readonly CamoufoxOs[]): string {
    const fontsDir = join(installDir, 'fonts');
    mkdirSync(fontsDir, { recursive: true });
    writeFileSync(join(fontsDir, 'groups.json'), JSON.stringify({ readBy: READ_BY }));
    const groups = new Set(oses.flatMap((os) => READ_BY[OS_KEYS[os]] ?? []));
    for (const group of groups) addGroup(fontsDir, group);
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

    it.each<[string, (groupDir: string) => void]>([
      ['missing', () => undefined],
      ['a regular file', (groupDir) => writeFileSync(groupDir, FONT_BYTES)],
      ['an empty directory', (groupDir) => mkdirSync(groupDir)],
      ['a directory of subdirectories only', (groupDir) => mkdirSync(join(groupDir, 'nested'), { recursive: true })],
      ['a directory of zero-byte files only', (groupDir) => {
        mkdirSync(groupDir);
        writeFileSync(join(groupDir, 'Ubuntu.ttf'), '');
      }],
      ['a directory of dangling symlinks only', (groupDir) => {
        mkdirSync(groupDir);
        symlinkSync(join(groupDir, 'gone.ttf'), join(groupDir, 'Ubuntu.ttf'));
      }],
    ])('does not count a font set as installed when one of its groups is %s', (_label, layOut) => {
      addGroup(fontsDir, 'L');
      layOut(join(fontsDir, 'LM'));

      expect(failureOf({ CAMOUFOX_OS: 'linux' }).endsWith('has no linux fonts. Unset CAMOUFOX_OS or set it to one of: windows.'))
        .toBe(true);
    });

    it.skipIf(process.getuid?.() === 0)('stops when its user cannot list a group of the selected font set', () => {
      const windowsDir = join(fontsDir, 'W');
      chmodSync(windowsDir, 0o000);

      try {
        expect(failureOf({})).toContain('has no fonts for any OS');
      } finally {
        chmodSync(windowsDir, 0o755);
      }
    });

    it.skipIf(process.getuid?.() === 0)('stops when its user cannot read any font in a group of the selected set', () => {
      const font = join(fontsDir, 'W', 'Candara.ttf');
      chmodSync(font, 0o000);

      try {
        expect(failureOf({})).toContain('has no fonts for any OS');
      } finally {
        chmodSync(font, 0o644);
      }
    });

    it('accepts a font set whose fonts are symlinks to readable files', () => {
      const store = join(home, 'font-store');
      mkdirSync(store);
      writeFileSync(join(store, 'Ubuntu.ttf'), FONT_BYTES);
      addGroup(fontsDir, 'L');
      mkdirSync(join(fontsDir, 'LM'));
      symlinkSync(join(store, 'Ubuntu.ttf'), join(fontsDir, 'LM', 'Ubuntu.ttf'));

      const result = check({ CAMOUFOX_OS: 'linux' });

      expect(result.success && result.data.os).toBe('linux');
    });
  });

  it('lists every remaining font set, sorted', () => {
    installFonts(join(home, '.cache', 'camoufox'), ['windows', 'linux']);

    expect(failureOf({ CAMOUFOX_OS: 'macos' }).endsWith('one of: linux, windows.')).toBe(true);
  });

  it('does not suggest unsetting CAMOUFOX_OS when the default Windows set is missing too', () => {
    const fontsDir = installFonts(join(home, '.cache', 'camoufox'), ['linux']);

    expect(failureOf({})).toBe(
      `Camoufox font check failed: CAMOUFOX_OS=(unset) selects the windows fingerprint, but ${fontsDir} has no windows `
      + 'fonts. Set CAMOUFOX_OS to one of: linux.');
  });

  it('asks for a reinstall when the fonts directory holds no OS set, naming an unset value plainly', () => {
    const fontsDir = installFonts(join(home, '.cache', 'camoufox'), []);

    const message = failureOf({});

    expect(message).toBe(
      `Camoufox font check failed: CAMOUFOX_OS=(unset) selects the windows fingerprint, but ${fontsDir} has no fonts `
      + 'for any OS. Reinstall the pinned Camoufox build.');
    expect(message).not.toContain('undefined');
  });

  it.each<[string, (fontsDir: string) => void]>([
    ['is missing, as in the old per-OS layout', (fontsDir) => {
      rmSync(join(fontsDir, 'groups.json'));
      addGroup(fontsDir, 'windows');
    }],
    ['is not JSON', (fontsDir) => writeFileSync(join(fontsDir, 'groups.json'), '{')],
    ['names no Windows groups', (fontsDir) => {
      writeFileSync(join(fontsDir, 'groups.json'), JSON.stringify({ readBy: { ...READ_BY, win: [] } }));
    }],
    ['names a path instead of a Windows group', (fontsDir) => {
      writeFileSync(join(fontsDir, 'groups.json'), JSON.stringify({ readBy: { ...READ_BY, win: ['W', '../fonts/W'] } }));
    }],
  ])('asks for a reinstall when groups.json %s', (_label, damage) => {
    const fontsDir = installFonts(join(home, '.cache', 'camoufox'), ['windows']);
    damage(fontsDir);

    expect(failureOf({})).toBe(
      `Camoufox font check failed: CAMOUFOX_OS=(unset) selects the windows fingerprint, but ${fontsDir} has no fonts `
      + 'for any OS. Reinstall the pinned Camoufox build.');
  });

  it('leaves startup unchanged when no browser is installed', () => {
    expect(check({ CAMOUFOX_OS: 'linux' }).success).toBe(true);
  });

  it('stops an install whose fonts directory is gone, since the browser would launch with fallback fonts', () => {
    const installDir = join(home, '.cache', 'camoufox');
    mkdirSync(installDir, { recursive: true });
    writeFileSync(join(installDir, 'camoufox-bin'), '');

    expect(failureOf({})).toContain(`but ${join(installDir, 'fonts')} has no fonts for any OS. Reinstall`);
  });

  it.skipIf(process.getuid?.() === 0)('stops an install whose fonts its user cannot read', () => {
    const installDir = join(home, '.cache', 'camoufox');
    installFonts(installDir, ['windows']);
    chmodSync(installDir, 0o000);

    try {
      expect(failureOf({})).toContain('has no fonts for any OS');
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
