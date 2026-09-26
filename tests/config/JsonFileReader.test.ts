import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { encryptConfig } from '../../src/Config/ConfigEncryption.js';
import readJsonFile from '../../src/Config/Loaders/JsonFileReader.js';
import { ConfigurationError } from '../../src/Errors/ErrorTypes.js';
import type { IImporterConfig } from '../../src/Types/Index.js';

/**
 * Reads a file expected to be present, failing the test when it reads as absent.
 * @param path - File to read.
 * @returns The parsed config.
 */
function readPresent(path: string): IImporterConfig {
  const result = readJsonFile(path);
  if (!result.success) throw new Error(`expected ${path} to be read: ${result.message}`);
  return result.data;
}

/**
 * Stores original env vars so tests can clean them up deterministically.
 */
const originalEnv: Record<string, string | undefined> = {};
const ENC_KEYS = ['CREDENTIALS_ENCRYPTION_PASSWORD', 'CONFIG_PASSWORD'] as const;

let tmpDir: string;

describe('JsonFileReader.readJsonFile', () => {
  beforeEach(() => {
    for (const key of ENC_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    tmpDir = mkdtempSync(join(tmpdir(), 'jsonreader-'));
  });

  afterEach(() => {
    for (const key of ENC_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses a plain JSON config file', () => {
    const path = join(tmpDir, 'config.json');
    const body = {
      actual: {
        init: { dataDir: '/data', serverURL: 'http://s', password: 'p' },
        budget: { syncId: 's', password: null },
      },
      banks: {},
    };
    writeFileSync(path, JSON.stringify(body), 'utf8');
    const result = readPresent(path);
    expect(result.actual.init.dataDir).toBe('/data');
    expect(result.banks).toEqual({});
  });

  it('returns the parsed object unchanged when payload is not encrypted', () => {
    const path = join(tmpDir, 'plain.json');
    const body = { delayBetweenBanks: 1234, actual: {}, banks: {} };
    writeFileSync(path, JSON.stringify(body), 'utf8');
    expect(readPresent(path).delayBetweenBanks).toBe(1234);
  });

  it('decrypts an encrypted payload when password env var is set', () => {
    const plain = JSON.stringify({
      actual: {
        init: { dataDir: '/d', serverURL: 'http://s', password: 'p' },
        budget: { syncId: 's', password: null },
      },
      banks: {},
      delayBetweenBanks: 42,
    });
    const encrypted = encryptConfig(plain, 'test-passphrase');
    const path = join(tmpDir, 'enc.json');
    writeFileSync(path, encrypted, 'utf8');
    process.env.CREDENTIALS_ENCRYPTION_PASSWORD = 'test-passphrase';
    const result = readPresent(path);
    expect(result.delayBetweenBanks).toBe(42);
  });

  it('throws ConfigurationError when encrypted file has no password env var', () => {
    const plain = JSON.stringify({ actual: {}, banks: {} });
    const encrypted = encryptConfig(plain, 'pw');
    const path = join(tmpDir, 'enc-nopw.json');
    writeFileSync(path, encrypted, 'utf8');
    expect(() => readJsonFile(path)).toThrow(ConfigurationError);
    expect(() => readJsonFile(path)).toThrow(/CREDENTIALS_ENCRYPTION_PASSWORD/);
  });

  it('accepts the legacy CONFIG_PASSWORD env var as a fallback', () => {
    const plain = JSON.stringify({ actual: {}, banks: {}, delayBetweenBanks: 7 });
    const encrypted = encryptConfig(plain, 'legacy-pw');
    const path = join(tmpDir, 'enc-legacy.json');
    writeFileSync(path, encrypted, 'utf8');
    process.env.CONFIG_PASSWORD = 'legacy-pw';
    const result = readPresent(path);
    expect(result.delayBetweenBanks).toBe(7);
  });

  it('decrypts with CONFIG_PASSWORD when CREDENTIALS_ENCRYPTION_PASSWORD is empty', () => {
    const plain = JSON.stringify({ actual: {}, banks: {}, delayBetweenBanks: 9 });
    const path = join(tmpDir, 'enc-empty-primary.json');
    writeFileSync(path, encryptConfig(plain, 'legacy-pw'), 'utf8');
    process.env.CREDENTIALS_ENCRYPTION_PASSWORD = '';
    process.env.CONFIG_PASSWORD = 'legacy-pw';
    expect(readPresent(path).delayBetweenBanks).toBe(9);
  });

  it('throws on malformed JSON syntax', () => {
    const path = join(tmpDir, 'broken.json');
    writeFileSync(path, '{ "actual": ', 'utf8');
    expect(() => readJsonFile(path)).toThrow();
  });

  it('fails with ENOENT, without throwing, when the file does not exist', () => {
    const path = join(tmpDir, 'missing.json');
    const result = readJsonFile(path);
    expect(result).toMatchObject({ success: false, status: 'ENOENT' });
  });

  it('throws ConfigurationError naming the file when it is there but unreadable', () => {
    const path = join(tmpDir, 'config.json');
    mkdirSync(path);
    expect(() => readJsonFile(path)).toThrow(ConfigurationError);
    expect(() => readJsonFile(path)).toThrow(`${path} is not a regular file`);
  });
});
