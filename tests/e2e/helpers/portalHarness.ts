/**
 * E2E harness for the config portal.
 *
 * Launches the SAME browser the product uses — Camoufox (a hardened Firefox,
 * via `@hieutran094/camoufox-js` + `playwright-core`) — and starts the REAL
 * in-process portal server against a freshly seeded temp config directory, so
 * tests can drive the served SPA exactly as a user would. No chromium, no
 * mocks: real browser, real Fastify routes, real file writes.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Camoufox } from '@hieutran094/camoufox-js';
import type { FastifyInstance } from 'fastify';
import type { Browser } from 'playwright-core';

import { hashPassword } from '../../../src/Portal/PortalPassword.js';
import type { IPortalRuntime } from '../../../src/Portal/PortalRuntime.js';
import { startPortal } from '../../../src/Portal/PortalServer.js';
import type { IImporterConfig, IPortalConfig } from '../../../src/Types/Index.js';

/** Known plaintext portal password seeded for the login flow. */
export const PORTAL_PASSWORD = 'e2e-portal-pass-9182';

/** Strong session secret (>=16 chars) required by the weak-secret boot guard. */
const SESSION_SECRET = 'e2e-portal-session-secret-0123456789';

/** A running portal instance plus its on-disk paths and base URL. */
export interface IPortalServer {
  app: FastifyInstance;
  baseUrl: string;
  dir: string;
  configPath: string;
  credsPath: string;
}

/**
 * Launches the product's Camoufox (Firefox) browser in headless mode.
 *
 * The binary is the one the scraper toolchain already installs (host cache or
 * the CI `camoufox-js fetch` step), so this never needs chromium and is never
 * skipped — a missing browser fails the test loudly.
 * @returns A Playwright Browser instance ready to open pages.
 */
export async function launchPortalBrowser(): Promise<Browser> {
  return await Camoufox({ headless: true });
}

/**
 * Builds a password-mode portal runtime seeded with a known hashed password.
 * @returns Resolved runtime bound to an ephemeral localhost port.
 */
function passwordRuntime(): IPortalRuntime {
  const portal: IPortalConfig = {
    enabled: true,
    host: '127.0.0.1',
    port: 0,
    authMode: 'password',
    passwordHash: hashPassword(PORTAL_PASSWORD),
    sessionSecret: SESSION_SECRET,
  };
  return {
    host: '127.0.0.1', port: 0, authMode: 'password',
    sessionSecret: SESSION_SECRET, portal,
  };
}

/**
 * Writes the given config to a fresh temp dir as config.json.
 * @param config - Importer config to seed on disk.
 * @returns The temp dir and the config.json path inside it.
 */
function seed(config: IImporterConfig): { dir: string; configPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'portal-e2e-'));
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  return { dir, configPath };
}

/**
 * Reads the actual TCP port a started Fastify server is listening on.
 * @param app - The listening Fastify instance.
 * @returns The bound port number.
 */
function boundPort(app: FastifyInstance): number {
  const address = app.server.address();
  return address && typeof address === 'object' ? address.port : 0;
}

/**
 * Seeds a temp config and starts the real portal on an ephemeral port.
 * @param config - Importer config to seed and edit through the UI.
 * @returns The running server handle (app, baseUrl, on-disk paths).
 */
export async function startSeededPortal(config: IImporterConfig): Promise<IPortalServer> {
  const { dir, configPath } = seed(config);
  const app = await startPortal(passwordRuntime(), configPath);
  const baseUrl = `http://127.0.0.1:${String(boundPort(app))}`;
  return { app, baseUrl, dir, configPath, credsPath: join(dir, 'credentials.json') };
}
