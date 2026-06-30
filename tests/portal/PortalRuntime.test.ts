import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isNonLoopbackHost, isPortalEnabled, isSessionSecretWeak, portalAuthConfigError,
  portalBootBlocker, portalCookieOptions, resolvePortalRuntime, resolveSecureCookies,
} from '../../src/Portal/PortalRuntime.js';
import type { PortalAuthMode } from '../../src/Types/Index.js';
import { fakeImporterConfig } from '../helpers/factories.js';
import { fakeGoogleConfig, fakePortalConfig, fakePortalRuntime } from '../helpers/portalFactories.js';

const ENV_KEYS = ['PORTAL_ENABLED', 'PORTAL_HOST', 'PORTAL_PORT', 'PORTAL_SECURE_COOKIES'] as const;
const saved: Record<string, string | undefined> = {};

describe('PortalRuntime', () => {
  beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  describe('isPortalEnabled', () => {
    it('is true when PORTAL_ENABLED=true', () => {
      process.env.PORTAL_ENABLED = 'true';
      expect(isPortalEnabled(fakeImporterConfig())).toBe(true);
    });

    it('is true when config.portal.enabled is true', () => {
      expect(isPortalEnabled(fakeImporterConfig({ portal: { enabled: true } }))).toBe(true);
    });

    it('is false with no env and disabled config', () => {
      expect(isPortalEnabled(fakeImporterConfig())).toBe(false);
    });

    it('lets PORTAL_ENABLED=false override an enabled config (env wins)', () => {
      process.env.PORTAL_ENABLED = 'false';
      expect(isPortalEnabled(fakeImporterConfig({ portal: { enabled: true } }))).toBe(false);
    });

    it('lets PORTAL_ENABLED=true override a disabled config (env wins)', () => {
      process.env.PORTAL_ENABLED = 'true';
      expect(isPortalEnabled(fakeImporterConfig({ portal: { enabled: false } }))).toBe(true);
    });
  });

  describe('resolvePortalRuntime', () => {
    it('applies safe defaults when portal is absent', () => {
      const rt = resolvePortalRuntime(fakeImporterConfig());
      expect(rt.host).toBe('127.0.0.1');
      expect(rt.port).toBe(8080);
      expect(rt.authMode).toBe('password');
      expect(rt.sessionSecret).toBe('');
    });

    it('treats blank PORTAL_HOST/PORTAL_PORT env as unset so config wins', () => {
      process.env.PORTAL_HOST = '   ';
      process.env.PORTAL_PORT = '';
      const config = fakeImporterConfig({ portal: { enabled: true, host: '0.0.0.0', port: 9999 } });
      const rt = resolvePortalRuntime(config);
      expect(rt.host).toBe('0.0.0.0');
      expect(rt.port).toBe(9999);
    });

    it('treats whitespace-only PORTAL_PORT env as unset so config wins', () => {
      process.env.PORTAL_PORT = '   ';
      const config = fakeImporterConfig({ portal: { enabled: true, host: '0.0.0.0', port: 9999 } });
      const rt = resolvePortalRuntime(config);
      expect(rt.host).toBe('0.0.0.0');
      expect(rt.port).toBe(9999);
    });

    it('falls back to the loopback default when the config host is blank', () => {
      const config = fakeImporterConfig({ portal: { enabled: true, host: '   ', port: 9999 } });
      const rt = resolvePortalRuntime(config);
      expect(rt.host).toBe('127.0.0.1');
      expect(rt.port).toBe(9999);
    });

    it('honours config values', () => {
      const config = fakeImporterConfig({
        portal: { enabled: true, host: '0.0.0.0', port: 9999, authMode: 'both', sessionSecret: 's3cret' },
      });
      const rt = resolvePortalRuntime(config);
      expect(rt).toMatchObject({ host: '0.0.0.0', port: 9999, authMode: 'both', sessionSecret: 's3cret' });
    });

    it('lets env override host and port', () => {
      process.env.PORTAL_HOST = '10.0.0.5';
      process.env.PORTAL_PORT = '3000';
      const rt = resolvePortalRuntime(fakeImporterConfig({ portal: { enabled: true, host: '0.0.0.0', port: 9999 } }));
      expect(rt.host).toBe('10.0.0.5');
      expect(rt.port).toBe(3000);
    });

    it('falls back to the default port when the value is non-numeric', () => {
      process.env.PORTAL_PORT = 'not-a-number';
      expect(resolvePortalRuntime(fakeImporterConfig()).port).toBe(8080);
    });

    it('coerces an unknown auth mode to password', () => {
      const config = fakeImporterConfig({ portal: { enabled: true, authMode: 'bogus' as PortalAuthMode } });
      expect(resolvePortalRuntime(config).authMode).toBe('password');
    });
  });

  describe('isSessionSecretWeak', () => {
    it('flags empty, too-short, and known placeholder secrets', () => {
      expect(isSessionSecretWeak('')).toBe(true);
      expect(isSessionSecretWeak('short')).toBe(true);
      expect(isSessionSecretWeak('change-me-portal-secret')).toBe(true);
    });

    it('accepts a sufficiently long, non-placeholder secret', () => {
      expect(isSessionSecretWeak('a-strong-session-secret')).toBe(false);
    });
  });

  describe('isNonLoopbackHost', () => {
    it('is false for loopback hosts that stay on the local machine', () => {
      expect(isNonLoopbackHost('127.0.0.1')).toBe(false);
      expect(isNonLoopbackHost('::1')).toBe(false);
      expect(isNonLoopbackHost('localhost')).toBe(false);
    });

    it('is true for network-exposed bind hosts', () => {
      expect(isNonLoopbackHost('0.0.0.0')).toBe(true);
      expect(isNonLoopbackHost('10.0.0.5')).toBe(true);
    });
  });

  describe('resolveSecureCookies', () => {
    it('defaults to false and honours the config flag', () => {
      expect(resolveSecureCookies({ enabled: true })).toBe(false);
      expect(resolveSecureCookies({ enabled: true, secureCookies: true })).toBe(true);
    });

    it('lets PORTAL_SECURE_COOKIES env override the config flag', () => {
      process.env.PORTAL_SECURE_COOKIES = 'true';
      expect(resolveSecureCookies({ enabled: true })).toBe(true);
      process.env.PORTAL_SECURE_COOKIES = 'false';
      expect(resolveSecureCookies({ enabled: true, secureCookies: true })).toBe(false);
    });

    it('is surfaced on the resolved runtime', () => {
      process.env.PORTAL_SECURE_COOKIES = 'true';
      expect(resolvePortalRuntime(fakeImporterConfig()).secureCookies).toBe(true);
    });
  });

  describe('portalCookieOptions', () => {
    it('marks cookies Secure per the runtime and omits maxAge by default', () => {
      const secure = portalCookieOptions(fakePortalRuntime({ secureCookies: true }));
      expect(secure).toEqual({ path: '/', httpOnly: true, sameSite: 'lax', secure: true });
    });

    it('includes maxAge when provided and reflects an insecure runtime', () => {
      const opts = portalCookieOptions(fakePortalRuntime({ secureCookies: false }), 600);
      expect(opts).toEqual({ path: '/', httpOnly: true, sameSite: 'lax', secure: false, maxAge: 600 });
    });
  });

  describe('portalAuthConfigError', () => {
    it('returns empty when password mode has a passwordHash', () => {
      const rt = fakePortalRuntime({ authMode: 'password', portal: fakePortalConfig({ authMode: 'password' }) });
      expect(portalAuthConfigError(rt)).toBe('');
    });

    it('flags password/both mode that has no passwordHash', () => {
      const portal = fakePortalConfig({ authMode: 'both', passwordHash: undefined });
      expect(portalAuthConfigError(fakePortalRuntime({ authMode: 'both', portal }))).toMatch(/passwordHash/);
    });

    it('flags google/both mode with an incomplete google client', () => {
      const portal = fakePortalConfig({ authMode: 'google', google: undefined });
      expect(portalAuthConfigError(fakePortalRuntime({ authMode: 'google', portal }))).toMatch(/google/);
    });

    it('flags google/both mode whose google client has no allowedEmails', () => {
      const portal = fakePortalConfig({ authMode: 'google', google: fakeGoogleConfig({ allowedEmails: [] }) });
      expect(portalAuthConfigError(fakePortalRuntime({ authMode: 'google', portal }))).toMatch(/allowedEmails/);
    });

    it('flags google/both mode whose google fields are whitespace-only', () => {
      const google = fakeGoogleConfig({ clientId: '   ', clientSecret: ' ', redirectUri: '\t' });
      const portal = fakePortalConfig({ authMode: 'google', google });
      expect(portalAuthConfigError(fakePortalRuntime({ authMode: 'google', portal }))).toMatch(/google/);
    });

    it('flags google/both mode whose allowedEmails entries are all blank', () => {
      const portal = fakePortalConfig({ authMode: 'google', google: fakeGoogleConfig({ allowedEmails: ['  ', '\t'] }) });
      expect(portalAuthConfigError(fakePortalRuntime({ authMode: 'google', portal }))).toMatch(/allowedEmails/);
    });

    it('accepts google/both mode when a real allowedEmails entry sits beside blank ones', () => {
      const portal = fakePortalConfig({ authMode: 'both', google: fakeGoogleConfig({ allowedEmails: ['  ', 'allowed@example.com'] }) });
      expect(portalAuthConfigError(fakePortalRuntime({ authMode: 'both', portal }))).toBe('');
    });

    it('returns empty when both mode has a password and a complete google client', () => {
      const portal = fakePortalConfig({ authMode: 'both', google: fakeGoogleConfig() });
      expect(portalAuthConfigError(fakePortalRuntime({ authMode: 'both', portal }))).toBe('');
    });
  });

  describe('portalBootBlocker', () => {
    it('blocks a weak session secret', () => {
      const portal = fakePortalConfig({ sessionSecret: 'weak' });
      expect(portalBootBlocker(fakePortalRuntime({ sessionSecret: 'weak', portal }))).toMatch(/sessionSecret/);
    });

    it('returns empty when the runtime is fully configured', () => {
      expect(portalBootBlocker(fakePortalRuntime())).toBe('');
    });
  });
});
