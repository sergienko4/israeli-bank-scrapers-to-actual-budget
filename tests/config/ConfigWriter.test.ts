import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import ConfigWriter from '../../src/Config/ConfigWriter.js';
import { isSuccess } from '../../src/Types/Index.js';
import { fakeBankConfig, fakeImporterConfig } from '../helpers/factories.js';
import { TEST_ENCRYPTION_KEY } from '../helpers/testCredentials.js';

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
    const result = new ConfigWriter(configPath).write(config);
    expect(isSuccess(result)).toBe(true);
    const settings = JSON.parse(readFileSync(configPath, 'utf8'));
    const creds = JSON.parse(readFileSync(credPath, 'utf8'));
    expect(settings.banks.discount.password).toBeUndefined();
    expect(creds.banks.discount.password).toBe('pw');
  });

  it('does not leave a plaintext .bak backup when overwriting an existing config', () => {
    const writer = new ConfigWriter(configPath);
    const first = writer.write(fakeImporterConfig({ banks: { discount: fakeBankConfig({ password: 'first-pw' }) } }));
    const second = writer.write(fakeImporterConfig({ banks: { discount: fakeBankConfig({ password: 'second-pw' }) } }));
    expect(isSuccess(first)).toBe(true);
    expect(isSuccess(second)).toBe(true);
    expect(existsSync(`${configPath}.bak`)).toBe(false);
    expect(existsSync(`${credPath}.bak`)).toBe(false);
  });

  it('encrypts credentials.json when CREDENTIALS_ENCRYPTION_PASSWORD is set', () => {
    process.env.CREDENTIALS_ENCRYPTION_PASSWORD = TEST_ENCRYPTION_KEY;
    new ConfigWriter(configPath).write(fakeImporterConfig());
    expect(JSON.parse(readFileSync(credPath, 'utf8')).encrypted).toBe(true);
  });

  it('leaves no plaintext secret on disk after an encrypted save', () => {
    process.env.CREDENTIALS_ENCRYPTION_PASSWORD = TEST_ENCRYPTION_KEY;
    const inlineSecret = 'prior-plaintext-pw';
    // Simulate a pre-encryption state: plaintext secrets already sitting on disk.
    writeFileSync(configPath, JSON.stringify({ banks: { discount: { id: '1', password: inlineSecret } } }));
    writeFileSync(credPath, JSON.stringify({ banks: { discount: { password: inlineSecret } } }));
    const config = fakeImporterConfig({ banks: { discount: fakeBankConfig({ id: '1', password: inlineSecret }) } });
    const result = new ConfigWriter(configPath).write(config);
    expect(isSuccess(result)).toBe(true);
    expect(JSON.parse(readFileSync(credPath, 'utf8')).encrypted).toBe(true);
    const onDisk = readdirSync(dir).filter(name => statSync(join(dir, name)).isFile());
    const leaking = onDisk.filter(name => readFileSync(join(dir, name), 'utf8').includes(inlineSecret));
    expect(leaking).toEqual([]);
  });

  it('leaves config.json intact when credentials.json cannot be written', () => {
    const inlineSecret = 'inline-secret-pw';
    writeFileSync(configPath, JSON.stringify({ banks: { discount: { id: '1', password: inlineSecret } } }));
    mkdirSync(`${credPath}.tmp`);
    const config = fakeImporterConfig({ banks: { discount: fakeBankConfig({ id: '1', password: inlineSecret }) } });
    const result = new ConfigWriter(configPath).write(config);
    expect(isSuccess(result)).toBe(false);
    expect(readFileSync(configPath, 'utf8')).toContain(inlineSecret);
    expect(existsSync(credPath)).toBe(false);
  });
});
