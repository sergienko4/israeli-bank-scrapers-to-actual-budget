import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG_PATH, resolveConfigPath } from '../../src/Config/ConfigPath.js';

describe('resolveConfigPath', () => {
  const original = process.env.CONFIG_PATH;

  beforeEach(() => { delete process.env.CONFIG_PATH; });
  afterEach(() => {
    if (original === undefined) delete process.env.CONFIG_PATH;
    else process.env.CONFIG_PATH = original;
  });

  it('returns the CONFIG_PATH env value when it is set', () => {
    process.env.CONFIG_PATH = '/app/config/config.json';
    expect(resolveConfigPath()).toBe('/app/config/config.json');
  });

  it('falls back to the container default when CONFIG_PATH is unset', () => {
    delete process.env.CONFIG_PATH;
    expect(resolveConfigPath()).toBe(DEFAULT_CONFIG_PATH);
    expect(DEFAULT_CONFIG_PATH).toBe('/app/config.json');
  });

  it('treats an empty CONFIG_PATH as unset and uses the default', () => {
    process.env.CONFIG_PATH = '';
    expect(resolveConfigPath()).toBe(DEFAULT_CONFIG_PATH);
  });

  it('treats a whitespace-only CONFIG_PATH as unset and uses the default', () => {
    process.env.CONFIG_PATH = '   ';
    expect(resolveConfigPath()).toBe(DEFAULT_CONFIG_PATH);
  });

  it('trims surrounding whitespace from a set CONFIG_PATH', () => {
    process.env.CONFIG_PATH = '  /srv/data/config.json  ';
    expect(resolveConfigPath()).toBe('/srv/data/config.json');
  });

  it('keeps the unset default at /app/config.json for non-Docker bare-metal boot', () => {
    // bootConfigAndLogger() feeds this value into ConfigLoader; it must match the
    // loader's own no-arg default so local runs without CONFIG_PATH are not regressed.
    delete process.env.CONFIG_PATH;
    expect(resolveConfigPath()).toBe('/app/config.json');
  });
});
