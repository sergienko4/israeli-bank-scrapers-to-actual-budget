import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import readJsonOrEncrypted from '../../../src/Scheduler/Config/ConfigFileReader.js';
import { isFail, isSuccess } from '../../../src/Types/Index.js';

/** Windows has neither `mkfifo` nor POSIX permission bits. */
const IS_WINDOWS = process.platform === 'win32';
/** Root reads a file whatever its mode, so permission cases cannot fail. */
const IS_ROOT = process.getuid?.() === 0;

let dir: string;
let configPath: string;

describe('readJsonOrEncrypted on real files', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'schedreader-'));
    configPath = join(dir, 'config.json');
  });
  afterEach(() => {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a plain config.json', () => {
    writeFileSync(configPath, '{"foo":"bar"}');
    const read = readJsonOrEncrypted(configPath);
    expect(isSuccess(read) && read.data).toEqual({ foo: 'bar' });
  });

  it('reports a missing file as not found', () => {
    const read = readJsonOrEncrypted(configPath);
    expect(isFail(read) && read.message).toBe(`File not found: ${configPath}`);
  });

  it('refuses a directory, naming it', () => {
    mkdirSync(configPath);
    const read = readJsonOrEncrypted(configPath);
    expect(isFail(read) && read.message).toBe(`${configPath} is not a regular file`);
  });

  it.skipIf(IS_WINDOWS)('refuses a FIFO without waiting for a writer', () => {
    execFileSync('mkfifo', [configPath]);
    const read = readJsonOrEncrypted(configPath);
    expect(isFail(read) && read.message).toBe(`${configPath} is not a regular file`);
  });

  it.skipIf(IS_WINDOWS || IS_ROOT)('reports a file it cannot reach, not a missing one', () => {
    writeFileSync(configPath, '{}');
    chmodSync(dir, 0o000);
    const read = readJsonOrEncrypted(configPath);
    expect(isFail(read) && read.message).toBe(`Could not read ${configPath}: EACCES`);
  });
});
