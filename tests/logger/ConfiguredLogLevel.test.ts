/**
 * Configured log level tests.
 *
 * The portal writes `logConfig.level`; loggers read the level from the
 * environment when they are constructed. These guard the handover between the
 * two so an operator can raise verbosity from the portal and re-run without
 * editing config files over SSH.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyConfiguredLogLevel, baseOptions } from '../../src/Logger/LoggerOptions.js';
import type { IImporterConfig } from '../../src/Types/Index.js';

/**
 * Builds a minimal importer config carrying an optional log level.
 * @param level - Configured log level, omitted to leave logConfig empty.
 * @returns An importer config shaped for the level handover.
 */
function buildConfig(level?: string): IImporterConfig {
  return { actual: {}, banks: {}, logConfig: { level } } as unknown as IImporterConfig;
}

describe('applyConfiguredLogLevel', () => {
  const original = process.env.LOG_LEVEL;

  beforeEach(() => {
    process.env.LOG_LEVEL = 'info';
  });

  afterEach(() => {
    if (original === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = original;
  });

  it('publishes the configured level to newly built loggers', () => {
    expect(applyConfiguredLogLevel(buildConfig('trace'))).toBe('trace');
    expect(baseOptions().level).toBe('trace');
  });

  it('keeps the environment level when config does not set one', () => {
    expect(applyConfiguredLogLevel(buildConfig())).toBe('info');
    expect(baseOptions().level).toBe('info');
  });

  it('keeps the environment level when logConfig is absent entirely', () => {
    const config = { actual: {}, banks: {} } as unknown as IImporterConfig;
    expect(applyConfiguredLogLevel(config)).toBe('info');
  });

  it('lets the portal raise verbosity to debug for a diagnostic re-run', () => {
    applyConfiguredLogLevel(buildConfig('debug'));
    expect(process.env.LOG_LEVEL).toBe('debug');
  });
});
