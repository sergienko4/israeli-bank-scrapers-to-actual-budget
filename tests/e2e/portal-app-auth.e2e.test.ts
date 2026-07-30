/**
 * End-to-end mobile-app sign-in against a real portal.
 *
 * This is the proof behind the whole Design A change: a phone can reach a
 * portal that requires Google *and* a password, and end up holding a bearer
 * token that actually opens `/api` — something the legacy password-only token
 * could never do in `both` mode.
 *
 * The final hop of the authorize flow is fetched rather than followed in the
 * browser on purpose. The portal answers with a redirect to
 * `bankimporter://auth`, and no browser can resolve an app's custom scheme; a
 * real phone hands that URL to the OS instead. Fetching it with the browser's
 * own cookies exercises the identical server path and lets the test read the
 * `Location` header the OS would have received.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { IImporterConfig, IPortalAppConfig } from '../../src/Types/Index.js';
import { fakeBankConfig, fakeBankTarget, fakeImporterConfig } from '../helpers/factories.js';
import {
  GOOGLE_TEST_EMAIL,
  type IFakeGoogle,
  type IGooglePortalServer,
  type IPortalServer,
  launchPortalBrowser,
  PORTAL_PASSWORD,
  startFakeGoogle,
  startSeededGooglePortal,
  startSeededPortal,
} from './helpers/portalHarness.js';

/** The only redirect target the seeded portals accept. */
const REDIRECT_URI = 'bankimporter://auth';

/** How the app names itself when it asks for a code. */
const DEVICE_NAME = 'Pixel 8';

/** A PKCE verifier and the S256 challenge derived from it. */
interface IPkcePair {
  verifier: string;
  challenge: string;
}

/** A browser signed in to a portal that has app sign-in switched on. */
interface IAppFixture {
  server: IPortalServer;
  context: BrowserContext;
  page: Page;
}

/** The Google-backed variant, which also owns the fake identity provider. */
interface IGoogleFixture extends IAppFixture {
  server: IGooglePortalServer;
  fake: IFakeGoogle;
}

/** The two Google endpoints the portal reads from the environment. */
interface IGoogleEnvBackup {
  authBase: string | undefined;
  tokenUrl: string | undefined;
}

let browser: Browser;

beforeAll(async () => {
  browser = await launchPortalBrowser();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

/**
 * Builds the `portal.app` block the harness seeds into config.json.
 * @returns App sign-in enabled for the single custom-scheme redirect URI.
 */
function appConfig(): IPortalAppConfig {
  return {
    enabled: true,
    redirectUris: [REDIRECT_URI],
    accessTokenTtlMinutes: 15,
    refreshTokenTtlDays: 60,
  };
}

/**
 * Derives a PKCE pair the same way RFC 7636 says to, independently of the
 * portal's own implementation, so a bug in `Pkce.ts` cannot hide here.
 * @returns A fresh verifier and its S256 challenge.
 */
function pkcePair(): IPkcePair {
  const verifier = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(verifier).digest();
  return { verifier, challenge: digest.toString('base64url') };
}

/**
 * Builds an authorize URL exactly as the app would.
 * @param base - Portal base URL.
 * @param challenge - PKCE challenge.
 * @param state - Opaque value the app expects back untouched.
 * @param redirectUri - Where the portal should send the code.
 * @returns The full authorize URL.
 */
function authorizeUrl(
  base: string,
  challenge: string,
  state: string,
  redirectUri: string = REDIRECT_URI,
): string {
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    device_name: DEVICE_NAME,
  });
  return `${base}/auth/app/authorize?${params.toString()}`;
}

/**
 * Serializes the browser's cookies for the portal into a request header.
 * @param context - Browser context holding the session cookie.
 * @param base - Portal base URL.
 * @returns A `Cookie` header value.
 */
async function cookieHeader(context: BrowserContext, base: string): Promise<string> {
  const cookies = await context.cookies(base);
  const pairs = cookies.map((cookie) => `${cookie.name}=${cookie.value}`);
  return pairs.join('; ');
}

/**
 * Requests an authorization code with the signed-in browser's cookies, without
 * following the redirect into the app's custom scheme.
 * @param fx - Signed-in fixture.
 * @param url - Authorize URL to request.
 * @returns The unfollowed response.
 */
async function authorizeAsUser(fx: IAppFixture, url: string): Promise<Response> {
  const cookie = await cookieHeader(fx.context, fx.server.baseUrl);
  return await fetch(url, { headers: { cookie }, redirect: 'manual' });
}

/**
 * Reads the code and state the portal handed back on the redirect.
 * @param location - The `Location` header value.
 * @returns The parsed code and state, blank when absent.
 */
function codeFrom(location: string): { code: string; state: string } {
  const target = new URL(location);
  return {
    code: target.searchParams.get('code') ?? '',
    state: target.searchParams.get('state') ?? '',
  };
}

/**
 * Posts JSON with no cookies at all, the way the app's HTTP client does.
 * @param url - Absolute URL to post to.
 * @param body - JSON body.
 * @returns The status code and parsed body.
 */
async function postJson(
  url: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body: parsed };
}

/**
 * Exchanges an authorization code for a token pair.
 * @param base - Portal base URL.
 * @param code - The authorization code.
 * @param verifier - The PKCE verifier that matches the code's challenge.
 * @param redirectUri - The redirect URI the code was issued for.
 * @returns The status code and parsed body.
 */
async function exchange(
  base: string,
  code: string,
  verifier: string,
  redirectUri: string = REDIRECT_URI,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return await postJson(`${base}/auth/app/token`, {
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
}

/**
 * Calls a guarded endpoint with an app access token and nothing else.
 * @param base - Portal base URL.
 * @param path - Path under `/api`.
 * @param accessToken - The bearer token to present.
 * @returns The raw response.
 */
async function callApi(base: string, path: string, accessToken: string): Promise<Response> {
  return await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

/**
 * Seeds a config with one bank so the portal has something real to serve.
 * @returns An importer config for the harness.
 */
function seedConfig(): IImporterConfig {
  return fakeImporterConfig({
    banks: { discount: fakeBankConfig({ targets: [fakeBankTarget()] }) },
  });
}

/**
 * Saves the Google endpoint overrides so a fixture can point them at the fake.
 * @returns The current values.
 */
function backupGoogleEnv(): IGoogleEnvBackup {
  return {
    authBase: process.env.GOOGLE_AUTH_BASE,
    tokenUrl: process.env.GOOGLE_TOKEN_URL,
  };
}

/**
 * Restores the Google endpoint overrides captured before a fixture ran.
 * @param backup - The saved values.
 */
function restoreGoogleEnv(backup: IGoogleEnvBackup): void {
  if (backup.authBase === undefined) delete process.env.GOOGLE_AUTH_BASE;
  else process.env.GOOGLE_AUTH_BASE = backup.authBase;
  if (backup.tokenUrl === undefined) delete process.env.GOOGLE_TOKEN_URL;
  else process.env.GOOGLE_TOKEN_URL = backup.tokenUrl;
}

/**
 * Clicks through the fake Google consent screen.
 * @param page - The portal page.
 */
async function approveGoogle(page: Page): Promise<void> {
  await page.click('#google-btn');
  await page.waitForSelector('#approve', { state: 'visible', timeout: 30_000 });
  await page.click('#approve');
}

/**
 * Submits the portal password.
 * @param page - The portal page.
 */
async function submitPassword(page: Page): Promise<void> {
  await page.waitForSelector('#pw', { state: 'visible', timeout: 30_000 });
  await page.fill('#pw', PORTAL_PASSWORD);
  await page.click('#pw-btn');
}

/**
 * Starts a `both`-mode portal with app sign-in on, behind a fake Google.
 * @returns A signed-out fixture parked on the portal's login screen.
 */
async function startGoogleFixture(): Promise<IGoogleFixture> {
  const fake = await startFakeGoogle();
  process.env.GOOGLE_AUTH_BASE = `${fake.base}/auth`;
  process.env.GOOGLE_TOKEN_URL = `${fake.base}/token`;
  let server: IGooglePortalServer | undefined;
  let context: BrowserContext | undefined;
  try {
    server = await startSeededGooglePortal(seedConfig(), {
      allowedEmails: [GOOGLE_TEST_EMAIL],
      authMode: 'both',
      app: appConfig(),
    });
    context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    await page.goto(server.baseUrl);
    return { server, fake, context, page };
  } catch (error: unknown) {
    if (context) await context.close();
    if (server) await server.app.close();
    await fake.close();
    throw error;
  }
}

/**
 * Tears down a Google fixture, tolerating a partially built one.
 * @param fx - The fixture, when it was created.
 */
async function stopGoogleFixture(fx: IGoogleFixture | undefined): Promise<void> {
  if (!fx) return;
  await fx.context.close();
  await fx.server.app.close();
  await fx.fake.close();
}

describe('portal app sign-in (both mode)', () => {
  let envBackup: IGoogleEnvBackup;
  let fx: IGoogleFixture;

  beforeAll(async () => {
    envBackup = backupGoogleEnv();
    fx = await startGoogleFixture();
  }, 120_000);

  afterAll(async () => {
    await stopGoogleFixture(fx);
    restoreGoogleEnv(envBackup);
  });

  it('carries the app from authorize to a working access token', async () => {
    const { verifier, challenge } = pkcePair();
    const state = 'e2e-state-happy-path';
    const url = authorizeUrl(fx.server.baseUrl, challenge, state);

    // A signed-out request parks the authorize URL and shows the login instead.
    await fx.page.goto(url);
    await fx.page.waitForSelector('#google-btn', { state: 'visible', timeout: 30_000 });
    expect(fx.page.url()).toContain('next=');

    // Sign in away from the parked URL, so the browser is never asked to follow
    // the redirect into a scheme only a phone can resolve.
    await fx.page.goto(fx.server.baseUrl);
    await approveGoogle(fx.page);
    await submitPassword(fx.page);
    await fx.page.waitForSelector('#app', { state: 'visible', timeout: 30_000 });

    // Now the same URL hands over a single-use code.
    const granted = await authorizeAsUser(fx, url);
    expect(granted.status).toBe(302);
    const location = granted.headers.get('location') ?? '';
    expect(location.startsWith(`${REDIRECT_URI}?code=`)).toBe(true);
    const handed = codeFrom(location);
    expect(handed.state).toBe(state);
    expect(handed.code.length).toBeGreaterThan(20);

    // The code buys a token pair.
    const issued = await exchange(fx.server.baseUrl, handed.code, verifier);
    expect(issued.status).toBe(200);
    expect(issued.body.tokenType).toBe('Bearer');
    expect(issued.body.expiresIn).toBe(900);
    const accessToken = String(issued.body.accessToken);
    const refreshToken = String(issued.body.refreshToken);
    const sessionId = String(issued.body.sessionId);
    expect(sessionId).toMatch(/^[\w-]{22}$/);

    // G1: the access token opens /api even though the portal demands both
    // factors, which is exactly what a password-only token could never do.
    const status = await callApi(fx.server.baseUrl, '/api/status', accessToken);
    expect(status.status).toBe(200);

    // The session is visible to the owner, and the record's secrets are not.
    const listed = await callApi(fx.server.baseUrl, '/api/app/sessions', accessToken);
    expect(listed.status).toBe(200);
    const rows = (await listed.json()) as { id: string; deviceName: string; current: boolean }[];
    const mine = rows.find((row) => row.id === sessionId);
    expect(mine?.deviceName).toBe(DEVICE_NAME);
    expect(mine?.current).toBe(true);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('tokenHash');
    expect(serialized).not.toContain('fingerprint');

    // Refreshing rotates the pair.
    const rotated = await postJson(`${fx.server.baseUrl}/auth/app/refresh`, { refreshToken });
    expect(rotated.status).toBe(200);
    const nextRefresh = String(rotated.body.refreshToken);
    expect(nextRefresh).not.toBe(refreshToken);
    const nextAccess = String(rotated.body.accessToken);
    const rolled = await callApi(fx.server.baseUrl, '/api/status', nextAccess);
    expect(rolled.status).toBe(200);

    // Presenting the spent token is evidence of a copy, so the family dies.
    const replayed = await postJson(`${fx.server.baseUrl}/auth/app/refresh`, { refreshToken });
    expect(replayed.status).toBe(400);
    expect(replayed.body.error).toBe('invalid_grant');
    const orphaned = await postJson(`${fx.server.baseUrl}/auth/app/refresh`, {
      refreshToken: nextRefresh,
    });
    expect(orphaned.status).toBe(400);
    expect(orphaned.body.error).toBe('invalid_grant');
  }, 120_000);

  it('refuses a code redeemed with the wrong verifier', async () => {
    const mine = pkcePair();
    const attacker = pkcePair();
    const url = authorizeUrl(fx.server.baseUrl, mine.challenge, 'e2e-state-wrong-verifier');
    const granted = await authorizeAsUser(fx, url);
    expect(granted.status).toBe(302);
    const handed = codeFrom(granted.headers.get('location') ?? '');

    const stolen = await exchange(fx.server.baseUrl, handed.code, attacker.verifier);
    expect(stolen.status).toBe(400);
    expect(stolen.body.error).toBe('invalid_grant');

    // The code is spent either way, so the honest holder cannot recover it.
    const honest = await exchange(fx.server.baseUrl, handed.code, mine.verifier);
    expect(honest.status).toBe(400);
  }, 120_000);

  it('treats a replayed code as a breach and kills what it issued', async () => {
    const { verifier, challenge } = pkcePair();
    const url = authorizeUrl(fx.server.baseUrl, challenge, 'e2e-state-replay');
    const granted = await authorizeAsUser(fx, url);
    const handed = codeFrom(granted.headers.get('location') ?? '');

    const first = await exchange(fx.server.baseUrl, handed.code, verifier);
    expect(first.status).toBe(200);
    const refreshToken = String(first.body.refreshToken);

    const second = await exchange(fx.server.baseUrl, handed.code, verifier);
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('invalid_grant');

    // Whoever replayed the code may already hold the pair it bought, so the
    // family it seeded is revoked rather than trusted.
    const afterBreach = await postJson(`${fx.server.baseUrl}/auth/app/refresh`, { refreshToken });
    expect(afterBreach.status).toBe(400);
    expect(afterBreach.body.error).toBe('invalid_grant');
  }, 120_000);

  it('refuses a redirect target that is not on the allow-list', async () => {
    const { challenge } = pkcePair();
    const url = authorizeUrl(
      fx.server.baseUrl,
      challenge,
      'e2e-state-bad-redirect',
      'bankimporter://stolen',
    );
    const refused = await authorizeAsUser(fx, url);
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { error: string };
    expect(body.error).toBe('invalid_redirect_uri');
  }, 120_000);

  it('refuses a malformed state and echoes a good one unchanged', async () => {
    const { challenge } = pkcePair();
    const bad = authorizeUrl(fx.server.baseUrl, challenge, 'has spaces and <angles>');
    const refused = await authorizeAsUser(fx, bad);
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { error: string };
    expect(body.error).toBe('invalid_state');

    // The app compares what comes back against what it sent, so the portal
    // must return the value byte for byte.
    const state = 'e2e-state~echo.check-1';
    const good = authorizeUrl(fx.server.baseUrl, challenge, state);
    const granted = await authorizeAsUser(fx, good);
    expect(granted.status).toBe(302);
    const handed = codeFrom(granted.headers.get('location') ?? '');
    expect(handed.state).toBe(state);
  }, 120_000);
});

describe('portal app sign-in when the auth mode changes underneath it', () => {
  let fx: IAppFixture;

  beforeAll(async () => {
    const server = await startSeededPortal(seedConfig(), appConfig());
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    await page.goto(server.baseUrl);
    fx = { server, context, page };
  }, 120_000);

  afterAll(async () => {
    if (!fx) return;
    await fx.context.close();
    await fx.server.app.close();
  });

  it('stops honouring a password-era token once both factors are required', async () => {
    const { verifier, challenge } = pkcePair();
    const url = authorizeUrl(fx.server.baseUrl, challenge, 'e2e-state-mode-change');

    await submitPassword(fx.page);
    await fx.page.waitForSelector('#app', { state: 'visible', timeout: 30_000 });

    const granted = await authorizeAsUser(fx, url);
    expect(granted.status).toBe(302);
    const handed = codeFrom(granted.headers.get('location') ?? '');
    const issued = await exchange(fx.server.baseUrl, handed.code, verifier);
    expect(issued.status).toBe(200);
    const accessToken = String(issued.body.accessToken);
    const refreshToken = String(issued.body.refreshToken);
    const before = await callApi(fx.server.baseUrl, '/api/status', accessToken);
    expect(before.status).toBe(200);

    // The operator turns Google on. Every route reads the live config, so the
    // token that only ever proved a password stops being enough immediately.
    const live = fx.server.store.raw();
    if (live.portal) live.portal.authMode = 'both';

    const after = await callApi(fx.server.baseUrl, '/api/status', accessToken);
    expect(after.status).toBe(401);

    // And it cannot be refreshed back into usefulness.
    const refused = await postJson(`${fx.server.baseUrl}/auth/app/refresh`, { refreshToken });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('invalid_grant');
  }, 120_000);
});
