import {
  existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import ConfigWriter from '../../src/Config/ConfigWriter.js';
import openConfigWriter from '../../src/Config/ConfigWriterWiring.js';
import { isStagingPath } from '../../src/Storage/StagingPaths.js';
import type { IImporterConfig, Procedure } from '../../src/Types/Index.js';
import { isSuccess } from '../../src/Types/Index.js';
import { fakeBankConfig, fakeImporterConfig } from '../helpers/factories.js';
import { TEST_ENCRYPTION_KEY } from '../helpers/testCredentials.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';

let dir: string;
let configPath: string;
let credPath: string;
const savedEnc = process.env.CREDENTIALS_ENCRYPTION_PASSWORD;

describe('ConfigWriter.write', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cfgwriter-'));
    configPath = join(dir, 'config.json');
    credPath = join(dir, 'credentials.json');
    delete process.env.CREDENTIALS_ENCRYPTION_PASSWORD;
  });
  afterEach(() => {
    if (savedEnc === undefined) delete process.env.CREDENTIALS_ENCRYPTION_PASSWORD;
    else process.env.CREDENTIALS_ENCRYPTION_PASSWORD = savedEnc;
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes config.json + credentials.json, splitting secrets', () => {
    const config = fakeImporterConfig({ banks: { discount: fakeBankConfig({ id: '1', password: 'pw' }) } });
    const result = openConfigWriter(configPath).write(config);
    expect(isSuccess(result)).toBe(true);
    const settings = JSON.parse(readFileSync(configPath, 'utf8'));
    const creds = JSON.parse(readFileSync(credPath, 'utf8'));
    expect(settings.banks.discount.password).toBeUndefined();
    expect(creds.banks.discount.password).toBe('pw');
  });

  it('does not leave a plaintext .bak backup when overwriting an existing config', () => {
    const writer = openConfigWriter(configPath);
    const first = writer.write(fakeImporterConfig({ banks: { discount: fakeBankConfig({ password: 'first-pw' }) } }));
    const second = writer.write(fakeImporterConfig({ banks: { discount: fakeBankConfig({ password: 'second-pw' }) } }));
    expect(isSuccess(first)).toBe(true);
    expect(isSuccess(second)).toBe(true);
    expect(existsSync(`${configPath}.bak`)).toBe(false);
    expect(existsSync(`${credPath}.bak`)).toBe(false);
  });

  it('encrypts credentials.json when CREDENTIALS_ENCRYPTION_PASSWORD is set', () => {
    process.env.CREDENTIALS_ENCRYPTION_PASSWORD = TEST_ENCRYPTION_KEY;
    openConfigWriter(configPath).write(fakeImporterConfig());
    expect(JSON.parse(readFileSync(credPath, 'utf8')).encrypted).toBe(true);
  });

  it('leaves no plaintext secret on disk after an encrypted save', () => {
    process.env.CREDENTIALS_ENCRYPTION_PASSWORD = TEST_ENCRYPTION_KEY;
    const inlineSecret = 'prior-plaintext-pw';
    // Simulate a pre-encryption state: plaintext secrets already sitting on disk.
    writeFileSync(configPath, JSON.stringify({ banks: { discount: { id: '1', password: inlineSecret } } }));
    writeFileSync(credPath, JSON.stringify({ banks: { discount: { password: inlineSecret } } }));
    const config = fakeImporterConfig({ banks: { discount: fakeBankConfig({ id: '1', password: inlineSecret }) } });
    const result = openConfigWriter(configPath).write(config);
    expect(isSuccess(result)).toBe(true);
    expect(JSON.parse(readFileSync(credPath, 'utf8')).encrypted).toBe(true);
    const onDisk = readdirSync(dir).filter(name => statSync(join(dir, name)).isFile());
    const leaking = onDisk.filter(name => readFileSync(join(dir, name), 'utf8').includes(inlineSecret));
    expect(leaking).toEqual([]);
  });

  it('does not follow a symlink planted at the old fixed staging name', () => {
    const victim = join(dir, 'victim.txt');
    writeFileSync(victim, 'untouched');
    symlinkSync(victim, `${credPath}.tmp`);
    const config = fakeImporterConfig({ banks: { discount: fakeBankConfig({ password: 'planted-pw' }) } });
    const result = openConfigWriter(configPath).write(config);
    expect(isSuccess(result)).toBe(true);
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
    expect(lstatSync(credPath).isSymbolicLink()).toBe(false);
    expect(JSON.parse(readFileSync(credPath, 'utf8')).banks.discount.password).toBe('planted-pw');
  });

  it('saves both files owner-only and leaves no staged file behind', () => {
    const result = openConfigWriter(configPath).write(fakeImporterConfig());
    expect(isSuccess(result)).toBe(true);
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(statSync(credPath).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).sort()).toEqual(['config.json', 'credentials.json']);
  });
});

const CONFIG = '/cfg/config.json';
const CREDS = '/cfg/credentials.json';
const OLD_CONFIG = '{"old":"config"}';
const OLD_CREDS = '{"old":"credentials"}';

/**
 * Builds a filesystem holding the pair a previous save left.
 * @returns A fake with both files seeded owner-only.
 */
function seededPair(): FakeFileSystem {
  const fake = new FakeFileSystem();
  fake.seedFile(CONFIG, OLD_CONFIG, 0o600);
  fake.seedFile(CREDS, OLD_CREDS, 0o600);
  return fake;
}

/**
 * Saves a config holding one bank password through the writer.
 * @param fake - Filesystem the writer uses.
 * @returns The writer's result.
 */
function saveTo(fake: FakeFileSystem): Procedure<{ written: true }> {
  const config: IImporterConfig = fakeImporterConfig({
    banks: { discount: fakeBankConfig({ id: '1', password: 'port-pw' }) },
  });
  return new ConfigWriter(fake, CONFIG).write(config);
}

/**
 * Asserts a failed save left the previous pair exactly as it was.
 * @param fake - Filesystem after the save.
 * @param result - The writer's result.
 */
function expectPairUnchanged(fake: FakeFileSystem, result: Procedure<{ written: true }>): void {
  expect(isSuccess(result)).toBe(false);
  expect(fake.contentsOf(CONFIG)).toBe(OLD_CONFIG);
  expect(fake.contentsOf(CREDS)).toBe(OLD_CREDS);
  expect(fake.names().sort()).toEqual([CONFIG, CREDS]);
}

describe('ConfigWriter on the filesystem port', () => {
  beforeEach(() => { delete process.env.CREDENTIALS_ENCRYPTION_PASSWORD; });
  afterEach(() => {
    if (savedEnc === undefined) delete process.env.CREDENTIALS_ENCRYPTION_PASSWORD;
    else process.env.CREDENTIALS_ENCRYPTION_PASSWORD = savedEnc;
  });

  it('stages each file under its own unpredictable name, credentials first', () => {
    const fake = seededPair();
    expect(isSuccess(saveTo(fake))).toBe(true);
    expect(isSuccess(saveTo(fake))).toBe(true);
    const [firstCreds, firstConfig, secondCreds] = fake.stagedPaths;
    expect(fake.stagedPaths).toHaveLength(4);
    expect(isStagingPath(CREDS, firstCreds)).toBe(true);
    expect(isStagingPath(CONFIG, firstConfig)).toBe(true);
    expect(secondCreds).not.toBe(firstCreds);
  });

  it('replaces both files owner-only, credentials holding the secret the config lacks', () => {
    const fake = seededPair();
    expect(isSuccess(saveTo(fake))).toBe(true);
    expect(JSON.parse(fake.contentsOf(CREDS)).banks.discount.password).toBe('port-pw');
    expect(JSON.parse(fake.contentsOf(CONFIG)).banks.discount.password).toBeUndefined();
    expect(fake.modeOf(CREDS)).toBe(0o600);
    expect(fake.modeOf(CONFIG)).toBe(0o600);
    expect(fake.names().sort()).toEqual([CONFIG, CREDS]);
  });

  it('removes nothing it does not own when the first stage fails', () => {
    const fake = seededPair();
    fake.failOnCall('createExclusive', 1, 'EEXIST');
    expectPairUnchanged(fake, saveTo(fake));
    expect(fake.calls).not.toContain('remove');
    expect(fake.calls).not.toContain('rename');
  });

  it.each([
    ['a failed second stage', (fake: FakeFileSystem): void => { fake.failOnCall('createExclusive', 2, 'ENOSPC'); }],
    ['a short second stage', (fake: FakeFileSystem): void => { fake.shortWriteOnCall(2); }],
    ['a short first stage', (fake: FakeFileSystem): void => { fake.shortWriteOnCall(1); }],
  ])('%s removes every staged file before any rename', (_label, arrange) => {
    const fake = seededPair();
    arrange(fake);
    expectPairUnchanged(fake, saveTo(fake));
    expect(fake.calls).not.toContain('rename');
  });

  it('reports a short stage as an incomplete write', () => {
    const fake = seededPair();
    fake.shortWriteOnCall(2);
    const result = saveTo(fake);
    if (result.success) throw new Error('expected the short stage to fail the save');
    expect(result.message).toMatch(/^Failed to write config: Staged \d+ of \d+ bytes$/);
  });

  it('removes both staged files when the first rename fails', () => {
    const fake = seededPair();
    fake.failOnCall('rename', 1, 'EACCES');
    expectPairUnchanged(fake, saveTo(fake));
  });

  it('leaves config.json unchanged and nothing staged when the second rename fails', () => {
    const fake = seededPair();
    fake.failOnCall('rename', 2, 'EACCES');
    const result = saveTo(fake);
    expect(isSuccess(result)).toBe(false);
    expect(fake.contentsOf(CONFIG)).toBe(OLD_CONFIG);
    expect(fake.names().sort()).toEqual([CONFIG, CREDS]);
  });

  it('keeps the original error when the cleanup fails too', () => {
    const fake = seededPair();
    fake.failOnCall('createExclusive', 2, 'ENOSPC');
    fake.forcedFailures.set('remove', 'EACCES');
    const result = saveTo(fake);
    if (result.success) throw new Error('expected the second stage to fail the save');
    expect(result.message).toBe('Failed to write config: forced createExclusive failure');
    expect(result.status).toBe('ENOSPC');
  });

  it('reports a config that cannot be serialised as a failure, touching nothing', () => {
    const fake = seededPair();
    const config = fakeImporterConfig();
    Object.assign(config, { unserialisable: 10n });
    const result = new ConfigWriter(fake, CONFIG).write(config);
    if (result.success) throw new Error('expected the serialisation to fail the save');
    expect(result.message).toMatch(/^Failed to write config: .*BigInt/);
    expectPairUnchanged(fake, result);
    expect(fake.calls).toEqual([]);
  });
});
