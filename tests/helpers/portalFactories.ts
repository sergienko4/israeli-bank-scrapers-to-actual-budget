/**
 * Test factories + tmp-dir helpers for the config portal.
 * Build real IPortalRuntime / IPortalConfig objects (no `as any`) and seed
 * on-disk config files so store/server tests exercise the real loader path.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IImporterConfig, IPortalConfig, IPortalGoogleConfig } from '../../src/Types/Index.js';
import type { IPortalRuntime } from '../../src/Portal/PortalRuntime.js';
import { hashPassword } from '../../src/Portal/PortalPassword.js';
import { fakeImporterConfig } from './factories.js';
import { TEST_CREDENTIAL } from './testCredentials.js';

/** Default password hashed for portal-login tests. */
export const PORTAL_TEST_PASSWORD = TEST_CREDENTIAL;

/**
 * Builds a portal config seeded with a hashed password + session secret.
 * @param overrides - Fields to override on the default portal config.
 * @returns IPortalConfig fixture.
 */
export function fakePortalConfig(overrides: Partial<IPortalConfig> = {}): IPortalConfig {
  return {
    enabled: true,
    host: '127.0.0.1',
    port: 8080,
    authMode: 'password',
    passwordHash: hashPassword(PORTAL_TEST_PASSWORD),
    sessionSecret: 'portal-test-secret',
    ...overrides,
  };
}

/**
 * Builds a Google OAuth config fixture for the portal.
 * @param overrides - Fields to override on the default google config.
 * @returns IPortalGoogleConfig fixture.
 */
export function fakeGoogleConfig(overrides: Partial<IPortalGoogleConfig> = {}): IPortalGoogleConfig {
  return {
    clientId: 'client-123.apps.googleusercontent.com',
    clientSecret: 'google-test-secret',
    redirectUri: 'http://127.0.0.1:8080/auth/google/callback',
    allowedEmails: ['allowed@example.com'],
    ...overrides,
  };
}

/**
 * Builds a fully-resolved portal runtime fixture.
 * @param overrides - Fields to override on the default runtime.
 * @returns IPortalRuntime fixture.
 */
export function fakePortalRuntime(overrides: Partial<IPortalRuntime> = {}): IPortalRuntime {
  const portal = overrides.portal ?? fakePortalConfig();
  return {
    host: '127.0.0.1',
    port: 0,
    authMode: portal.authMode ?? 'password',
    sessionSecret: portal.sessionSecret ?? 'portal-test-secret',
    secureCookies: portal.secureCookies ?? false,
    portal,
    ...overrides,
  };
}

/**
 * Creates a tmp dir and writes a config.json there for store/server tests. The
 * default config carries a password-mode portal block so the live auth routes —
 * which read the store's config, not the boot runtime — can log in with
 * {@link PORTAL_TEST_PASSWORD}.
 * @param config - Importer config to serialise (defaults to a valid fixture).
 * @returns The tmp dir + the config.json path inside it.
 */
export function seedConfigDir(
  config: IImporterConfig = fakeImporterConfig({ portal: fakePortalConfig() }),
): {
  dir: string; path: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'portal-'));
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf8');
  return { dir, path };
}
