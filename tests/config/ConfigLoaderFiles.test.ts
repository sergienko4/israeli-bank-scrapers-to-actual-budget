import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigLoader } from '../../src/Config/ConfigLoader.js';
import splitSecrets from '../../src/Config/SecretSplitter.js';
import { maskSecrets, restoreMasked } from '../../src/Portal/ConfigMutations.js';
import type { IProcedureFailure } from '../../src/Types/Index.js';
import { isFail, isSuccess } from '../../src/Types/Index.js';
import expectNoPollution from '../helpers/PrototypeOracle.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/Logger/Index.js', () => ({ getLogger: () => mockLogger }));

const CREDENTIALS_LOG = '🔑 Loading credentials from credentials.json';

/** Windows has neither `mkfifo` nor POSIX permission bits. */
const IS_WINDOWS = process.platform === 'win32';
/** Root reads a file whatever its mode, so permission cases cannot fail. */
const IS_ROOT = process.getuid?.() === 0;

let dir: string;
let configPath: string;
let credPath: string;

/**
 * Loads the config at {@link configPath}, which must fail.
 * @returns The failure the loader reported.
 */
function loadFailure(): IProcedureFailure {
  const loaded = new ConfigLoader(configPath).loadRaw();
  if (!isFail(loaded)) throw new Error('expected the config to fail to load');
  return loaded;
}

describe('ConfigLoader on real files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'cfgloader-'));
    configPath = join(dir, 'config.json');
    credPath = join(dir, 'credentials.json');
  });
  afterEach(() => {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads a config.json and credentials.json reached through symlinks', () => {
    mkdirSync(join(dir, 'mounted'));
    writeFileSync(join(dir, 'mounted', 'config.json'), '{"delayBetweenBanks":7}');
    writeFileSync(join(dir, 'mounted', 'credentials.json'), '{"banks":{"leumi":{"password":"linked"}}}');
    symlinkSync(join(dir, 'mounted', 'config.json'), configPath);
    symlinkSync(join(dir, 'mounted', 'credentials.json'), credPath);
    const loaded = new ConfigLoader(configPath).loadRaw();
    expect(isSuccess(loaded)).toBe(true);
    if (!isSuccess(loaded)) return;
    expect(loaded.data.delayBetweenBanks).toBe(7);
    expect(loaded.data.banks.leumi.password).toBe('linked');
    expect(mockLogger.info).toHaveBeenCalledWith(CREDENTIALS_LOG);
  });

  it('does not give a bank an inherited value from a __proto__ key in credentials.json', () => {
    writeFileSync(configPath, '{"banks":{"leumi":{"id":"1"}}}');
    writeFileSync(credPath, '{"banks":{"leumi":{"__proto__":{"password":"planted"}}}}');
    const loaded = new ConfigLoader(configPath).loadRaw();
    if (!isSuccess(loaded)) throw new Error(loaded.message);
    const bank = loaded.data.banks.leumi;
    expect(Object.getPrototypeOf(bank)).toBe(Object.prototype);
    expect('password' in bank).toBe(false);
  });

  it('gives no copy a planted prototype from a __proto__ key in config.json alone', () => {
    const planted = '{"banks":{"leumi":{"password":"pw","__proto__":{"password":"planted"}}}}';
    writeFileSync(configPath, planted);
    const loaded = new ConfigLoader(configPath).loadRaw();
    if (!isSuccess(loaded)) throw new Error(loaded.message);
    expectNoPollution(loaded.data);
    expectNoPollution(splitSecrets(loaded.data));
    expectNoPollution(maskSecrets(loaded.data));
    expectNoPollution(restoreMasked(loaded.data, loaded.data));
    expect(loaded.data.banks).toEqual({ leumi: { password: 'pw' } });
  });

  it('loads config.json alone when there is no credentials.json', () => {
    writeFileSync(configPath, '{"delayBetweenBanks":3}');
    const loaded = new ConfigLoader(configPath).loadRaw();
    expect(isSuccess(loaded) && loaded.data.delayBetweenBanks).toBe(3);
    expect(mockLogger.info).not.toHaveBeenCalledWith(CREDENTIALS_LOG);
  });

  it('refuses a config.json that is a directory, naming it', () => {
    mkdirSync(configPath);
    const failure = loadFailure();
    expect(failure.status).toBe('config-error');
    expect(failure.message).toBe(`${configPath} is not a regular file`);
  });

  it.skipIf(IS_WINDOWS)('refuses a credentials.json that is a FIFO, without waiting for a writer', () => {
    writeFileSync(configPath, '{}');
    execFileSync('mkfifo', [credPath]);
    const failure = loadFailure();
    expect(failure.status).toBe('config-error');
    expect(failure.message).toBe(`${credPath} is not a regular file`);
  });

  it.skipIf(IS_WINDOWS || IS_ROOT)('refuses a config.json it cannot reach, instead of using the environment', () => {
    writeFileSync(configPath, '{}');
    chmodSync(dir, 0o000);
    const failure = loadFailure();
    expect(failure.status).toBe('config-error');
    expect(failure.message).toBe(`Could not read ${configPath}: EACCES`);
  });

  it('refuses a credentials.json that is not UTF-8, rather than altering a password, and names only the file', () => {
    writeFileSync(configPath, '{}');
    const badByteInPassword = Buffer.concat([
      Buffer.from('{"banks":{"leumi":{"password":"never-in-a-log'), Buffer.from([0xff]), Buffer.from('"}}}'),
    ]);
    writeFileSync(credPath, badByteInPassword);
    const failure = loadFailure();
    expect(failure.message).toBe(`${credPath} is not valid UTF-8`);
  });
});
