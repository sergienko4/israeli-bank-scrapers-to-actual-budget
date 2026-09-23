/**
 * StorePathGuards tests — proves each guard judges a symlink as a symlink
 * and never as whatever it points at.
 */

import { execFileSync } from 'node:child_process';
import {
  linkSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  enforceOwnerOnly, isMovableStore, isOccupied, readWithoutFollowing, STORE_OPEN_FLAGS,
} from '../../src/Scraper/Tokens/StorePathGuards.js';

/** Opens a path with the store's own flags, in a child that cannot hang this suite. */
const OPEN_ONCE = 'const fs = require("node:fs");'
  + 'fs.closeSync(fs.openSync(process.env.TARGET, Number(process.env.FLAGS)));';

/** Windows has neither the `mkfifo` binary nor the flags the pipe case proves. */
const IS_WINDOWS = process.platform === 'win32';

let dir = '';
let filePath = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'store-path-guards-'));
  filePath = join(dir, 'bank-tokens.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('isOccupied', () => {
  it('reports an empty path as free', () => {
    expect(isOccupied(filePath)).toBe(false);
  });

  it('reports a regular file as occupied', () => {
    writeFileSync(filePath, '{}');
    expect(isOccupied(filePath)).toBe(true);
  });

  it('reports a dangling symlink as occupied, unlike existsSync', () => {
    symlinkSync(join(dir, 'gone.json'), filePath);
    expect(isOccupied(filePath)).toBe(true);
  });
});

describe('enforceOwnerOnly', () => {
  it('restricts a world-readable store to its owner', () => {
    writeFileSync(filePath, '{}', { mode: 0o644 });
    expect(enforceOwnerOnly(filePath)).toBe(true);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('leaves a symlink target untouched, since chmod follows links', () => {
    const target = join(dir, 'target.json');
    writeFileSync(target, '{}', { mode: 0o644 });
    symlinkSync(target, filePath);
    expect(enforceOwnerOnly(filePath)).toBe(false);
    expect(statSync(target).mode & 0o777).toBe(0o644);
  });

  it('leaves a directory traversable rather than stripping its execute bit', () => {
    mkdirSync(filePath, { mode: 0o755 });
    expect(enforceOwnerOnly(filePath)).toBe(false);
    expect(statSync(filePath).mode & 0o777).toBe(0o755);
  });

  it('reports a path holding nothing as not hardened', () => {
    expect(enforceOwnerOnly(filePath)).toBe(false);
  });

  it('leaves a hard-linked inode alone, since its mode is shared', () => {
    const other = join(dir, 'someone-elses-file.txt');
    writeFileSync(other, 'not ours', { mode: 0o644 });
    linkSync(other, filePath);
    expect(enforceOwnerOnly(filePath)).toBe(false);
    expect(statSync(other).mode & 0o777).toBe(0o644);
  });

  it('still hardens an ordinary store, which shares its inode with nothing', () => {
    writeFileSync(filePath, '{}', { mode: 0o644 });
    expect(enforceOwnerOnly(filePath)).toBe(true);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });
});

describe('STORE_OPEN_FLAGS', () => {
  it.skipIf(IS_WINDOWS)('opens a pipe at once instead of waiting for a writer that never comes', () => {
    execFileSync('mkfifo', [filePath]);
    const env = { ...process.env, TARGET: filePath, FLAGS: String(STORE_OPEN_FLAGS) };

    const open = (): unknown => execFileSync(process.execPath, ['-e', OPEN_ONCE], { env, timeout: 3000 });

    expect(open).not.toThrow();
  });
});

describe('isMovableStore', () => {
  it('moves a regular file aside', () => {
    writeFileSync(filePath, '{}');
    expect(isMovableStore(filePath)).toBe(true);
  });

  it('moves a symlink aside, because rename relocates the link itself', () => {
    symlinkSync(join(dir, 'gone.json'), filePath);
    expect(isMovableStore(filePath)).toBe(true);
  });

  it('refuses a directory, which the deployment did not mean as a store', () => {
    mkdirSync(filePath);
    expect(isMovableStore(filePath)).toBe(false);
  });

  it('refuses a path holding nothing to move', () => {
    expect(isMovableStore(filePath)).toBe(false);
  });
});

describe('readWithoutFollowing', () => {
  it('returns the contents of a regular file', () => {
    writeFileSync(filePath, '{"banks":{}}');
    expect(readWithoutFollowing(filePath)).toBe('{"banks":{}}');
  });

  it('hardens the file it read to owner-only', () => {
    writeFileSync(filePath, '{}', { mode: 0o644 });
    readWithoutFollowing(filePath);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('refuses a symlink rather than reading what it points at', () => {
    const target = join(dir, 'target.json');
    writeFileSync(target, '{"banks":{}}');
    symlinkSync(target, filePath);
    expect(() => readWithoutFollowing(filePath)).toThrow();
  });

  it('refuses a directory', () => {
    mkdirSync(filePath);
    expect(() => readWithoutFollowing(filePath)).toThrow();
  });

  it('refuses a path holding nothing', () => {
    expect(() => readWithoutFollowing(filePath)).toThrow();
  });
});
