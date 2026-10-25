/**
 * Drives scripts/camoufox-font-prune.mjs as the Dockerfile does, against a
 * fonts directory laid out like the pinned Camoufox build's: one directory
 * per group of OSes that read a face, and groups.json naming the groups each
 * OS reads. The prune must leave exactly the Windows groups, and must refuse
 * to delete anything when the layout is not one it understands.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../scripts/camoufox-font-prune.mjs', import.meta.url));

/** groups.json as the pinned Camoufox build ships it. */
const READ_BY = {
  lin: ['L', 'LM', 'LMW', 'LW'],
  mac: ['LM', 'LMW', 'M', 'MW'],
  win: ['LMW', 'LW', 'MW', 'W'],
};
const ALL_GROUPS = ['L', 'LM', 'LMW', 'LW', 'M', 'MW', 'W'];
const ROOT_FILES = ['TwemojiMozilla.ttf', 'groups.json'];

describe('camoufox-font-prune', () => {
  let fontsDir: string;

  beforeEach(() => {
    fontsDir = mkdtempSync(join(tmpdir(), 'camoufox-font-prune-'));
  });

  afterEach(() => {
    rmSync(fontsDir, { recursive: true, force: true });
  });

  /**
   * Lays out font groups, each holding one font, plus the root files.
   * @param groups - Group directories to create.
   * @param readBy - The readBy map written to groups.json.
   */
  function layOut(groups: readonly string[], readBy: unknown = READ_BY): void {
    for (const group of groups) {
      mkdirSync(join(fontsDir, group));
      writeFileSync(join(fontsDir, group, 'face.ttf'), 'font');
    }
    writeFileSync(join(fontsDir, 'TwemojiMozilla.ttf'), 'font');
    writeFileSync(join(fontsDir, 'groups.json'), JSON.stringify({ groups: ALL_GROUPS, readBy }));
  }

  /**
   * Runs the prune CLI.
   * @param args - Arguments after the script path.
   * @returns The finished child process.
   */
  function prune(args: readonly string[] = [fontsDir]): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 10_000 });
  }

  /**
   * Lists the fonts directory.
   * @returns Sorted entry names.
   */
  function entries(): string[] {
    return readdirSync(fontsDir).sort();
  }

  it('keeps exactly the groups Windows reads, plus the files beside them, and is idempotent', () => {
    layOut(ALL_GROUPS);

    const first = prune();
    const second = prune();

    expect(first.status).toBe(0);
    expect(first.stdout).toContain('Kept font groups: LMW, LW, MW, W; removed: L, LM, M');
    expect(entries()).toEqual([...READ_BY.win, ...ROOT_FILES].sort());
    expect(existsSync(join(fontsDir, 'W', 'face.ttf'))).toBe(true);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('removed: none');
  });

  it.each<[string, () => void, string]>([
    ['the old per-OS layout without groups.json', () => {
      for (const os of ['linux', 'macos', 'windows']) mkdirSync(join(fontsDir, os));
    }, 'groups.json'],
    ['a groups.json with no Windows groups', () => layOut(ALL_GROUPS, { ...READ_BY, win: [] }), 'names no win font groups'],
    ['a groups.json naming a path, not a group', () => layOut(ALL_GROUPS, { ...READ_BY, win: ['../W'] }),
      'names no win font groups'],
    ['a Windows group that is missing', () => layOut(ALL_GROUPS.filter((group) => group !== 'MW')),
      'missing Windows font groups: MW'],
    ['a group that is a symlink', () => {
      layOut(ALL_GROUPS.filter((group) => group !== 'L'));
      symlinkSync(join(fontsDir, 'W'), join(fontsDir, 'L'));
    }, 'neither a file nor a directory: L'],
  ])('deletes nothing and fails for %s', (_label, arrange, reason) => {
    arrange();
    const before = entries();

    const run = prune();

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('ERROR: Camoufox font prune');
    expect(run.stderr).toContain(reason);
    expect(entries()).toEqual(before);
  });

  it('prints its usage and fails without exactly one fonts directory', () => {
    const run = prune([]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Usage: node scripts/camoufox-font-prune.mjs <fontsDir>');
  });
});
