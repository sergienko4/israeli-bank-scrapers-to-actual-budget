import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isPortalEnabled, resolvePortalRuntime } from '../../src/Portal/PortalRuntime.js';
import { fakeImporterConfig } from '../helpers/factories.js';

const ENV_KEYS = ['PORTAL_ENABLED', 'PORTAL_HOST', 'PORTAL_PORT'] as const;
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
  });

  describe('resolvePortalRuntime', () => {
    it('applies safe defaults when portal is absent', () => {
      const rt = resolvePortalRuntime(fakeImporterConfig());
      expect(rt.host).toBe('127.0.0.1');
      expect(rt.port).toBe(8080);
      expect(rt.authMode).toBe('password');
      expect(rt.sessionSecret).toBe('change-me-portal-secret');
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
  });
});
