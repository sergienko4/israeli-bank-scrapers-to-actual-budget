/**
 * StorePathGuards tests — proves each guard judges a symlink as a symlink
 * and never as whatever it points at.
 */

import {
  mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  enforceOwnerOnly, isMovableStore, isOccupied, isRealFile,
} from '../../src/Scraper/Tokens/StorePathGuards.js';

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

describe('isRealFile', () => {
  it('accepts a regular file', () => {
    writeFileSync(filePath, '{}');
    expect(isRealFile(filePath)).toBe(true);
  });

  it('refuses a symlink even when its target is a real file', () => {
    const target = join(dir, 'target.json');
    writeFileSync(target, '{}');
    symlinkSync(target, filePath);
    expect(isRealFile(filePath)).toBe(false);
  });

  it('refuses a directory', () => {
    mkdirSync(filePath);
    expect(isRealFile(filePath)).toBe(false);
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
