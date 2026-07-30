/**
 * Covers resolution of the `portal.app` config block: defaults, the fallback
 * applied to every invalid field, env override precedence, and the rule that
 * an empty redirect allow-list disables app sign-in entirely.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { isValidRedirectUri, resolvePortalApp } from '../../src/Portal/PortalAppConfig.js';
import type { IPortalAppConfig, IPortalConfig } from '../../src/Types/Index.js';

const ENV_KEYS = ['PORTAL_APP_ENABLED', 'PORTAL_APP_REDIRECT_URIS'] as const;

/**
 * Builds a portal config whose app block is enabled with one usable redirect.
 * @param app - Fields to override on the app block.
 * @returns A portal config carrying the requested app block.
 */
function config(app: Partial<IPortalAppConfig> = {}): IPortalConfig {
  return {
    enabled: true,
    app: { enabled: true, redirectUris: ['bankimporter://auth'], ...app },
  };
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('isValidRedirectUri', () => {
  it('accepts a custom scheme with a host', () => {
    expect(isValidRedirectUri('bankimporter://auth')).toBe(true);
  });

  it('accepts an https URI', () => {
    expect(isValidRedirectUri('https://app.example.com/auth')).toBe(true);
  });

  it('rejects a URI with no scheme separator', () => {
    expect(isValidRedirectUri('bankimporter:auth')).toBe(false);
  });

  it('rejects a URI carrying a fragment', () => {
    expect(isValidRedirectUri('bankimporter://auth#code')).toBe(false);
  });

  it('rejects a URI containing whitespace', () => {
    expect(isValidRedirectUri('bankimporter://au th')).toBe(false);
  });

  it('rejects an empty URI', () => {
    expect(isValidRedirectUri('')).toBe(false);
  });

  it('rejects a URI longer than 512 characters', () => {
    const long = `bankimporter://auth/${'a'.repeat(512)}`;
    expect(isValidRedirectUri(long)).toBe(false);
  });
});

describe('resolvePortalApp defaults', () => {
  it('disables app sign-in when the block is absent', () => {
    const resolved = resolvePortalApp({ enabled: true });
    expect(resolved.enabled).toBe(false);
    expect(resolved.redirectUris).toEqual([]);
  });

  it('applies the documented TTL defaults', () => {
    const resolved = resolvePortalApp(config());
    expect(resolved.accessTokenTtlMinutes).toBe(15);
    expect(resolved.refreshTokenTtlDays).toBe(60);
  });

  it('enables the feature when a usable redirect URI is configured', () => {
    expect(resolvePortalApp(config()).enabled).toBe(true);
  });

  it('stays disabled while enabled is false', () => {
    expect(resolvePortalApp(config({ enabled: false })).enabled).toBe(false);
  });
});

describe('resolvePortalApp redirect URIs', () => {
  it('drops invalid entries and keeps the rest', () => {
    const resolved = resolvePortalApp(config({
      redirectUris: ['bankimporter://auth', 'no-scheme', 'https://ok.example/cb'],
    }));
    expect(resolved.redirectUris).toEqual(['bankimporter://auth', 'https://ok.example/cb']);
  });

  it('trims surrounding whitespace before storing an entry', () => {
    const resolved = resolvePortalApp(config({ redirectUris: ['  bankimporter://auth  '] }));
    expect(resolved.redirectUris).toEqual(['bankimporter://auth']);
  });

  it('disables the feature when every entry is invalid', () => {
    const resolved = resolvePortalApp(config({ redirectUris: ['nope', ''] }));
    expect(resolved.enabled).toBe(false);
    expect(resolved.redirectUris).toEqual([]);
  });

  it('disables the feature when the list is empty', () => {
    expect(resolvePortalApp(config({ redirectUris: [] })).enabled).toBe(false);
  });

  it('ignores a redirectUris value that is not an array', () => {
    const broken = { enabled: true, app: { enabled: true, redirectUris: 'bankimporter://auth' } };
    const resolved = resolvePortalApp(broken as unknown as IPortalConfig);
    expect(resolved.redirectUris).toEqual([]);
  });
});

describe('resolvePortalApp TTL validation', () => {
  it('falls back on a non-integer access TTL', () => {
    expect(resolvePortalApp(config({ accessTokenTtlMinutes: 1.5 })).accessTokenTtlMinutes).toBe(15);
  });

  it('falls back on an access TTL below the minimum', () => {
    expect(resolvePortalApp(config({ accessTokenTtlMinutes: 0 })).accessTokenTtlMinutes).toBe(15);
  });

  it('falls back on an access TTL above the maximum', () => {
    expect(resolvePortalApp(config({ accessTokenTtlMinutes: 61 })).accessTokenTtlMinutes).toBe(15);
  });

  it('keeps a legal access TTL', () => {
    expect(resolvePortalApp(config({ accessTokenTtlMinutes: 30 })).accessTokenTtlMinutes).toBe(30);
  });

  it('falls back on a refresh TTL outside 1-365', () => {
    expect(resolvePortalApp(config({ refreshTokenTtlDays: 366 })).refreshTokenTtlDays).toBe(60);
  });

  it('keeps a legal refresh TTL', () => {
    expect(resolvePortalApp(config({ refreshTokenTtlDays: 7 })).refreshTokenTtlDays).toBe(7);
  });

  it('falls back when a TTL arrives as a string', () => {
    const broken = { enabled: true, app: { refreshTokenTtlDays: '30' } };
    const resolved = resolvePortalApp(broken as unknown as IPortalConfig);
    expect(resolved.refreshTokenTtlDays).toBe(60);
  });
});

describe('resolvePortalApp env overrides', () => {
  it('forces the feature on', () => {
    process.env.PORTAL_APP_ENABLED = 'true';
    expect(resolvePortalApp(config({ enabled: false })).enabled).toBe(true);
  });

  it('forces the feature off', () => {
    process.env.PORTAL_APP_ENABLED = 'false';
    expect(resolvePortalApp(config()).enabled).toBe(false);
  });

  it('ignores an override that is not true or false', () => {
    process.env.PORTAL_APP_ENABLED = 'yes';
    expect(resolvePortalApp(config({ enabled: false })).enabled).toBe(false);
  });

  it('replaces the configured allow-list with a comma separated env list', () => {
    process.env.PORTAL_APP_REDIRECT_URIS = 'app://one, app://two';
    const resolved = resolvePortalApp(config());
    expect(resolved.redirectUris).toEqual(['app://one', 'app://two']);
  });

  it('drops invalid entries from the env list', () => {
    process.env.PORTAL_APP_REDIRECT_URIS = 'app://one,broken';
    expect(resolvePortalApp(config()).redirectUris).toEqual(['app://one']);
  });

  it('disables the feature when the env list has no usable entry', () => {
    process.env.PORTAL_APP_REDIRECT_URIS = 'broken';
    expect(resolvePortalApp(config()).enabled).toBe(false);
  });

  it('ignores a blank env list and keeps the configured one', () => {
    process.env.PORTAL_APP_REDIRECT_URIS = '   ';
    expect(resolvePortalApp(config()).redirectUris).toEqual(['bankimporter://auth']);
  });
});
