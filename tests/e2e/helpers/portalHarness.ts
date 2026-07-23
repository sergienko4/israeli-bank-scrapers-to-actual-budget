/**
 * E2E harness for the config portal.
 *
 * Launches the SAME browser the product uses — Camoufox (a hardened Firefox,
 * via `@hieutran094/camoufox-js` + `playwright-core`) — and starts the REAL
 * in-process portal server against a freshly seeded temp config directory, so
 * tests can drive the served SPA exactly as a user would. No chromium, no
 * mocks: real browser, real Fastify routes, real file writes.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Camoufox } from '@hieutran094/camoufox-js';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Browser, Locator } from 'playwright-core';

import { hashPassword } from '../../../src/Portal/PortalPassword.js';
import type { IPortalRuntime } from '../../../src/Portal/PortalRuntime.js';
import PortalConfigStore from '../../../src/Portal/PortalConfigStore.js';
import { buildPortal } from '../../../src/Portal/PortalServer.js';
import type {
  IImporterConfig, IPortalConfig, IPortalGoogleConfig,
} from '../../../src/Types/Index.js';

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
 * skipped — a missing browser fails the test loudly. A fixed window size is
 * passed because Camoufox derives the CSS layout viewport (and thus responsive
 * breakpoints) from the real window, not from Playwright's per-context viewport;
 * pinning it keeps desktop vs. mobile flows deterministic. Tests therefore open
 * contexts with `viewport: null` (no Playwright viewport emulation): Camoufox
 * uses this window instead, and it avoids the Firefox `Browser.setDefaultViewport`
 * call whose `isMobile` field Playwright >=1.61 sends and the Camoufox Juggler
 * rejects ("viewport.isMobile ... not described in this scheme").
 * @param window - Fixed `[width, height]` window size (default desktop).
 * @returns A Playwright Browser instance ready to open pages.
 */
export async function launchPortalBrowser(
  window: [number, number] = [1280, 900],
): Promise<Browser> {
  return await Camoufox({ headless: true, window });
}

/**
 * Sets an input's value reliably under the Camoufox Juggler. Playwright's
 * `fill()` appends to a pre-filled input here instead of replacing it (filling
 * "30" over a seeded "10" yields "1030", which then fails save-gate
 * validation). Clears via keyboard select-all + delete, then types the value.
 * @param locator - Input locator to set.
 * @param value - Value to type after clearing.
 * @returns Resolves once the value has been typed.
 */
export async function setValue(locator: Locator, value: string): Promise<void> {
  await locator.click();
  await locator.press('ControlOrMeta+a');
  await locator.press('Backspace');
  await locator.pressSequentially(value);
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
    sessionSecret: SESSION_SECRET, secureCookies: false, portal,
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
 * Builds the real portal (buildPortal + explicit store) and binds it to an
 * ephemeral port, returning the store so callers can inspect/patch the live
 * config the auth routes read per request (e.g. the Google redirectUri).
 * @param runtime - Boot runtime to bind with.
 * @param configPath - Path to the seeded config.json backing the store.
 * @returns The listening app and its config store.
 */
async function startWithStore(
  runtime: IPortalRuntime, configPath: string,
): Promise<{ app: FastifyInstance; store: PortalConfigStore }> {
  const store = new PortalConfigStore(configPath);
  const app = await buildPortal(runtime, store);
  try {
    await app.listen({ host: runtime.host, port: runtime.port });
    return { app, store };
  } catch (error: unknown) {
    await app.close();
    throw error;
  }
}

/**
 * Seeds a temp config and starts the real portal on an ephemeral port. The
 * runtime's portal block is written into the seeded config so the live auth
 * routes (which read the store's config, not the boot runtime) log in cleanly.
 * @param config - Importer config to seed and edit through the UI.
 * @returns The running server handle (app, baseUrl, on-disk paths).
 */
export async function startSeededPortal(config: IImporterConfig): Promise<IPortalServer> {
  const runtime = passwordRuntime();
  const { dir, configPath } = seed({ ...config, portal: runtime.portal });
  let app: FastifyInstance | undefined;
  try {
    const started = await startWithStore(runtime, configPath);
    app = started.app;
    const baseUrl = `http://127.0.0.1:${String(boundPort(app))}`;
    return { app, baseUrl, dir, configPath, credsPath: join(dir, 'credentials.json') };
  } catch (error: unknown) {
    if (app) await app.close();
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/** Email the fake-Google stub vouches for; allow-list it to log in. */
export const GOOGLE_TEST_EMAIL = 'e2e-user@example.com';

/** A running portal whose Google endpoints point at a local fake-Google stub. */
export interface IGooglePortalServer extends IPortalServer {
  runtime: IPortalRuntime;
}

/** A running fake-Google stub plus its base URL and teardown. */
export interface IFakeGoogle {
  base: string;
  close: () => Promise<void>;
}

/** Options for a Google-mode portal harness. */
export interface IGooglePortalOptions {
  allowedEmails: string[];
  authMode?: 'google' | 'both';
}

/** Google client id the fake OAuth server issues tokens for (matches the runtime). */
const GOOGLE_CLIENT_ID = 'e2e-client-id';

/**
 * Builds a fake Google id_token JWT (`header.payload.sig`) vouching for an
 * email. Carries the issuer/audience/expiry the portal now verifies (the
 * signature is still unsigned — the token arrives over a trusted channel — so
 * no real key is needed for the stub).
 * @param email - Email claim to embed, marked verified.
 * @returns A compact JWT string.
 */
function makeIdToken(email: string): string {
  const enc = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = enc({ alg: 'none', typ: 'JWT' });
  const payload = enc({
    email, email_verified: true, iss: 'https://accounts.google.com',
    aud: GOOGLE_CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return `${header}.${payload}.sig`;
}

/**
 * Renders the fake-Google consent page with a single "approve" link that
 * redirects back to the portal callback with a code + the echoed state.
 * @param target - Fully-built (percent-encoded) callback URL with code + state.
 * @param email - Email shown on the consent button for realism.
 * @returns Minimal HTML for the consent screen.
 */
function consentPage(target: string, email: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>`
    + `<title>Sign in - Google</title></head><body>`
    + `<a id="approve" href="${target}">Continue as ${email}</a></body></html>`;
}

/**
 * Starts an in-process fake-Google OAuth server: a consent page at `/auth` and
 * a token endpoint at `/token` returning an id_token for the given email. Point
 * `GOOGLE_AUTH_BASE`/`GOOGLE_TOKEN_URL` at it to drive the real portal flow.
 * @param email - Email the stub vouches for (default {@link GOOGLE_TEST_EMAIL}).
 * @returns The stub's base URL and a close handle.
 */
export async function startFakeGoogle(email: string = GOOGLE_TEST_EMAIL): Promise<IFakeGoogle> {
  const app = Fastify({ logger: false });
  app.addContentTypeParser(
    'application/x-www-form-urlencoded', { parseAs: 'string' },
    (_req, body, done) => { done(null, body); },
  );
  app.get('/auth', (req, reply) => {
    const query = req.query as { redirect_uri?: string; state?: string };
    const target = new URL(query.redirect_uri ?? '');
    target.searchParams.set('code', 'fake-auth-code');
    target.searchParams.set('state', query.state ?? '');
    return reply.type('text/html').send(consentPage(target.toString(), email));
  });
  app.post('/token', (_req, reply) => reply.send({ id_token: makeIdToken(email) }));
  await app.listen({ host: '127.0.0.1', port: 0 });
  return { base: `http://127.0.0.1:${String(boundPort(app))}`, close: () => app.close() };
}

/**
 * Builds a Google-mode portal runtime; `redirectUri` is patched after the
 * server binds (the routes read it live, so the real callback port is used).
 * @param opts - Allowed emails and optional `both` mode.
 * @returns Resolved runtime bound to an ephemeral localhost port.
 */
function googleRuntime(opts: IGooglePortalOptions): IPortalRuntime {
  const authMode = opts.authMode ?? 'google';
  const google: IPortalGoogleConfig = {
    clientId: GOOGLE_CLIENT_ID, clientSecret: 'e2e-client-secret',
    redirectUri: 'http://127.0.0.1:0/auth/google/callback', allowedEmails: opts.allowedEmails,
  };
  const portal: IPortalConfig = {
    enabled: true, host: '127.0.0.1', port: 0, authMode,
    sessionSecret: SESSION_SECRET, google,
  };
  if (authMode === 'both') portal.passwordHash = hashPassword(PORTAL_PASSWORD);
  return {
    host: '127.0.0.1', port: 0, authMode,
    sessionSecret: SESSION_SECRET, secureCookies: false, portal,
  };
}

/**
 * Patches the Google `redirectUri` to the real bound callback URL on both the
 * store's live config (which the routes read per request) and the returned
 * runtime (so tests can reference it).
 * @param store - Config store whose live Google config to patch.
 * @param runtime - Runtime returned to the test.
 * @param url - The real callback URL to set.
 * @returns void.
 */
function patchRedirectUri(store: PortalConfigStore, runtime: IPortalRuntime, url: string): void {
  const live = store.raw().portal?.google;
  if (live) live.redirectUri = url;
  if (runtime.portal.google) runtime.portal.google.redirectUri = url;
}

/**
 * Seeds a temp config and starts the real portal in Google (or `both`) mode,
 * then patches the Google `redirectUri` to the real bound callback URL. The
 * runtime's portal block is written to disk so the live auth routes resolve the
 * seeded Google client.
 * @param config - Importer config to seed.
 * @param opts - Allowed emails and optional auth mode.
 * @returns The running server handle including its resolved runtime.
 */
export async function startSeededGooglePortal(
  config: IImporterConfig, opts: IGooglePortalOptions,
): Promise<IGooglePortalServer> {
  const runtime = googleRuntime(opts);
  const { dir, configPath } = seed({ ...config, portal: runtime.portal });
  let app: FastifyInstance | undefined;
  try {
    const started = await startWithStore(runtime, configPath);
    app = started.app;
    const baseUrl = `http://127.0.0.1:${String(boundPort(app))}`;
    patchRedirectUri(started.store, runtime, `${baseUrl}/auth/google/callback`);
    return { app, baseUrl, dir, configPath, credsPath: join(dir, 'credentials.json'), runtime };
  } catch (error: unknown) {
    if (app) await app.close();
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
