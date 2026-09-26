import { execFileSync } from 'node:child_process';
import {
  chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import readConfigText, {
  CONFIG_READ_FLAGS, MAX_CONFIG_BYTES,
} from '../../src/Config/Loaders/ConfigFileText.js';
import type { IProcedureFailure } from '../../src/Types/Index.js';
import { isSuccess } from '../../src/Types/Index.js';

/** Windows has neither `mkfifo` nor POSIX permission bits. */
const IS_WINDOWS = process.platform === 'win32';
/** Root reads a file whatever its mode, so permission cases cannot fail. */
const IS_ROOT = process.getuid?.() === 0;

let dir: string;

/**
 * Reads a path that must fail, returning the failure.
 * @param filePath - Path to read.
 * @returns The failure the read reported.
 */
function failureOf(filePath: string): IProcedureFailure {
  const read = readConfigText(filePath);
  if (isSuccess(read)) throw new Error(`expected ${filePath} to fail`);
  return read;
}

describe('readConfigText', () => {
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cfgtext-')); });
  afterEach(() => {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a regular file as text', () => {
    const path = join(dir, 'config.json');
    writeFileSync(path, '{"banks":{}}');
    const read = readConfigText(path);
    expect(isSuccess(read) && read.data).toBe('{"banks":{}}');
  });

  it('follows a symlink to a regular file, as mounted configs need', () => {
    const target = join(dir, 'real.json');
    writeFileSync(target, '{"linked":true}');
    symlinkSync(target, join(dir, 'config.json'));
    const read = readConfigText(join(dir, 'config.json'));
    expect(isSuccess(read) && read.data).toBe('{"linked":true}');
  });

  it('reports a missing file as ENOENT', () => {
    const failure = failureOf(join(dir, 'config.json'));
    expect(failure.status).toBe('ENOENT');
  });

  it('reports a symlink to nothing as missing, as the old existence check did', () => {
    symlinkSync(join(dir, 'gone.json'), join(dir, 'config.json'));
    expect(failureOf(join(dir, 'config.json')).status).toBe('ENOENT');
  });

  it.skipIf(IS_WINDOWS)('opens with flags that cannot stall on a FIFO', () => {
    const fifo = join(dir, 'config.json');
    execFileSync('mkfifo', [fifo]);
    // The flags are handed to a child, so dropping O_NONBLOCK fails this test
    // by timing out instead of hanging the whole suite.
    const script = 'const fs = require("node:fs");'
      + 'fs.closeSync(fs.openSync(process.env.TARGET, Number(process.env.FLAGS)));'
      + 'console.log("returned");';
    const output = execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, TARGET: fifo, FLAGS: String(CONFIG_READ_FLAGS) },
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(output.trim()).toBe('returned');
  });

  it.skipIf(IS_WINDOWS)('refuses a FIFO, naming the path', () => {
    const fifo = join(dir, 'config.json');
    execFileSync('mkfifo', [fifo]);
    const failure = failureOf(fifo);
    expect(failure.status).toBe('EINVAL');
    expect(failure.message).toBe(`${fifo} is not a regular file`);
  });

  it('refuses a directory', () => {
    const path = join(dir, 'config.json');
    mkdirSync(path);
    expect(failureOf(path).message).toBe(`${path} is not a regular file`);
  });

  it('reads a file of exactly the cap', () => {
    const path = join(dir, 'config.json');
    writeFileSync(path, 'a'.repeat(MAX_CONFIG_BYTES));
    const read = readConfigText(path);
    expect(isSuccess(read) && read.data.length).toBe(MAX_CONFIG_BYTES);
  });

  it('refuses a file one byte over the cap', () => {
    const path = join(dir, 'config.json');
    writeFileSync(path, 'a'.repeat(MAX_CONFIG_BYTES + 1));
    const failure = failureOf(path);
    expect(MAX_CONFIG_BYTES).toBe(8 * 1024 * 1024);
    expect(failure.status).toBe('EFBIG');
    expect(failure.message).toBe(`${path} is larger than 8 MiB`);
  });

  it('refuses bytes that are not UTF-8, naming the path and not the contents', () => {
    const path = join(dir, 'config.json');
    const secretLooking = '{"password":"hunter2-do-not-log"';
    writeFileSync(path, Buffer.concat([Buffer.from(secretLooking), Buffer.from([0xff, 0xfe])]));
    const failure = failureOf(path);
    expect(failure.status).toBe('EILSEQ');
    expect(failure.message).toBe(`${path} is not valid UTF-8`);
  });

  it('keeps a leading byte-order mark, as a plain UTF-8 read did', () => {
    const path = join(dir, 'config.json');
    writeFileSync(path, '\uFEFF{}');
    const read = readConfigText(path);
    expect(isSuccess(read) && read.data).toBe('\uFEFF{}');
  });

  it.skipIf(IS_WINDOWS || IS_ROOT)('reports a file in an unreadable directory by its errno, not as missing', () => {
    const path = join(dir, 'config.json');
    writeFileSync(path, '{}');
    chmodSync(dir, 0o000);
    const failure = failureOf(path);
    expect(failure.status).toBe('EACCES');
    expect(failure.message).toBe(`Could not read ${path}: EACCES`);
  });

  it.skipIf(IS_WINDOWS)('releases its descriptor whatever the outcome', () => {
    const regular = join(dir, 'regular.json');
    const directory = join(dir, 'directory.json');
    const tooLarge = join(dir, 'large.json');
    const notUtf8 = join(dir, 'bytes.json');
    writeFileSync(regular, '{}');
    mkdirSync(directory);
    writeFileSync(tooLarge, 'a'.repeat(MAX_CONFIG_BYTES + 1));
    writeFileSync(notUtf8, Buffer.from([0xff]));
    const before = readdirSync('/dev/fd').length;
    for (const path of [regular, directory, tooLarge, notUtf8]) readConfigText(path);
    expect(readdirSync('/dev/fd').length).toBe(before);
  });
});
