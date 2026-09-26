import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { encryptConfig } from '../../../src/Config/ConfigEncryption.js';
import readJsonOrEncrypted from '../../../src/Scheduler/Config/ConfigFileReader.js';
import { isFail, isSuccess } from '../../../src/Types/Index.js';
import expectNoPollution from '../../helpers/PrototypeOracle.js';

/** A config holding a `__proto__` key at the top and inside a bank. */
const POLLUTED_CONFIG =
  '{"__proto__":{"a":1},"banks":{"leumi":{"password":"pw","__proto__":{"b":2}}}}';

/** The encryption password variable, restored after each test. */
const PASSWORD_KEY = 'CREDENTIALS_ENCRYPTION_PASSWORD';

/** Windows has neither `mkfifo` nor POSIX permission bits. */
const IS_WINDOWS = process.platform === 'win32';
/** Root reads a file whatever its mode, so permission cases cannot fail. */
const IS_ROOT = process.getuid?.() === 0;

let dir: string;
let configPath: string;
let savedPassword: string | undefined;

describe('readJsonOrEncrypted on real files', () => {
  beforeEach(() => {
    savedPassword = process.env[PASSWORD_KEY];
    dir = mkdtempSync(join(tmpdir(), 'schedreader-'));
    configPath = join(dir, 'config.json');
  });
  afterEach(() => {
    if (savedPassword === undefined) delete process.env[PASSWORD_KEY];
    else process.env[PASSWORD_KEY] = savedPassword;
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a plain config.json', () => {
    writeFileSync(configPath, '{"foo":"bar"}');
    const read = readJsonOrEncrypted(configPath);
    expect(isSuccess(read) && read.data).toEqual({ foo: 'bar' });
  });

  it('drops a __proto__ key at every level of a plain file', () => {
    writeFileSync(configPath, POLLUTED_CONFIG);
    const read = readJsonOrEncrypted(configPath);
    if (!isSuccess(read)) throw new Error(read.message);
    expectNoPollution(read.data);
    expect(read.data).toEqual({ banks: { leumi: { password: 'pw' } } });
  });

  it('drops a __proto__ key at every level of an encrypted file', () => {
    writeFileSync(configPath, encryptConfig(POLLUTED_CONFIG, 'sched-pass'));
    process.env[PASSWORD_KEY] = 'sched-pass';
    const read = readJsonOrEncrypted(configPath);
    if (!isSuccess(read)) throw new Error(read.message);
    expectNoPollution(read.data);
    expect(read.data).toEqual({ banks: { leumi: { password: 'pw' } } });
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
