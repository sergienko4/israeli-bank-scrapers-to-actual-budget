/**
 * Config secret values.
 *
 * <p>A bank can quote a credential back with no key in front of it. The
 * config is where the importer learns its credentials, so each place a
 * config enters the process must hand every secret value to the logger's
 * value masker. Then no output can show one, with or without a key.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigLoader } from '../../src/Config/ConfigLoader.js';
import registerConfigSecrets from '../../src/Config/ConfigSecretValues.js';
import ConfigWriter from '../../src/Config/ConfigWriter.js';
import SECRET_KEYS from '../../src/Config/SecretKeys.js';
import redactSecrets from '../../src/Logger/SecretRedaction.js';
import type { IImporterConfig } from '../../src/Types/Index.js';
import { fakeBankConfig, fakeImporterConfig } from '../helpers/factories.js';

/** Text outside the value, which masking must keep. */
const CANARY = 'form-error-canary';

/**
 * Wraps a value the way a bank's form error quotes it: bare, with no key.
 * @param value - The echoed credential.
 * @returns The provider text.
 */
function echoed(value: string): string {
  return `Form: ${value} is not valid ${CANARY}`;
}

/**
 * Builds a config holding each secret key in its own nested section.
 * @returns The config and the value placed under each key.
 */
function everySecretKey(): { config: IImporterConfig; values: [string, string][] } {
  const values = SECRET_KEYS.map((key, n): [string, string] => [key, `${key}-Vx${String(n)}-echo`]);
  const sections = Object.fromEntries(values.map(([key, value]) => [`s-${key}`, { inner: { [key]: value } }]));
  return { config: sections as unknown as IImporterConfig, values };
}

describe('registerConfigSecrets', () => {
  const { config, values } = everySecretKey();
  registerConfigSecrets(config);

  it.each(values)('hides the value of %s quoted with no key', (_key, value) => {
    const masked = redactSecrets(echoed(value));
    expect(masked).not.toContain(value);
    expect(masked).toContain(CANARY);
  });

  it('hides a numeric secret quoted with no key', () => {
    const numeric = { banks: { discount: { num: 98_765_432 } } };
    registerConfigSecrets(numeric as unknown as IImporterConfig);
    expect(redactSecrets(echoed('98765432'))).not.toContain('98765432');
  });

  it.each([
    ['as written', '+972 52-765-4321'],
    ['in canonical form', '972527654321'],
    ['with a plus', '+972527654321'],
    ['with a dash', '972-527654321'],
    ['in local form', '0527654321'],
    ['as national digits', '527654321'],
  ])('hides a phone number %s', (_form, wire) => {
    const phone = { banks: { oneZero: { phoneNumber: '+972 52-765-4321' } } };
    registerConfigSecrets(phone as unknown as IImporterConfig);
    const masked = redactSecrets(echoed(wire));
    expect(masked).not.toContain('527654321');
    expect(masked).not.toContain('52-765-4321');
  });

  it('keeps the values of other fields readable', () => {
    const plain = fakeImporterConfig();
    registerConfigSecrets(plain);
    const text = `${plain.actual.init.serverURL} ${plain.actual.budget.syncId} ${CANARY}`;
    expect(redactSecrets(text)).toBe(text);
  });

  it('accepts a config that is not an object', () => {
    const notObject = null as unknown as IImporterConfig;
    expect(() => registerConfigSecrets(notObject)).not.toThrow();
  });
});

describe('each place a config enters the process', () => {
  let dir: string;
  let configPath: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cfgsecrets-'));
    configPath = join(dir, 'config.json');
    delete process.env.CREDENTIALS_ENCRYPTION_PASSWORD;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Writes a config file whose Discount bank holds the given number.
   * @param num - The secret value to place in the file.
   * @returns The path written.
   */
  function writeConfigWith(num: string): string {
    const config = fakeImporterConfig({ banks: { discount: fakeBankConfig({ num }) } });
    writeFileSync(configPath, JSON.stringify(config));
    return configPath;
  }

  it('load registers the values in config.json', () => {
    const value = 'Load-Ec7-value';
    new ConfigLoader(writeConfigWith(value)).load();
    expect(redactSecrets(echoed(value))).not.toContain(value);
  });

  it('loadRaw registers the values in config.json', () => {
    const value = 'Raw-Ec8-value';
    new ConfigLoader(writeConfigWith(value)).loadRaw();
    expect(redactSecrets(echoed(value))).not.toContain(value);
  });

  it('loadWithoutEnvOverrides registers the values in credentials.json', () => {
    const value = 'Cred-Ec9-value';
    writeConfigWith('Plain-Ec0-value');
    const secrets = { banks: { discount: { userCode: value } } };
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify(secrets));
    new ConfigLoader(configPath).loadWithoutEnvOverrides();
    expect(redactSecrets(echoed(value))).not.toContain(value);
  });

  it('the environment fallback registers the values it reads', () => {
    const value = 'Env-Ec1-value';
    process.env.DISCOUNT_ID = 'Env-Ec1-id';
    process.env.DISCOUNT_NUM = value;
    new ConfigLoader(join(dir, 'missing.json')).loadRaw();
    expect(redactSecrets(echoed(value))).not.toContain(value);
  });

  it('ConfigWriter.write registers the values it saves', () => {
    const value = 'Write-Ec2-value';
    const config = fakeImporterConfig({ banks: { discount: fakeBankConfig({ username: value }) } });
    new ConfigWriter(configPath).write(config);
    expect(redactSecrets(echoed(value))).not.toContain(value);
  });
});
