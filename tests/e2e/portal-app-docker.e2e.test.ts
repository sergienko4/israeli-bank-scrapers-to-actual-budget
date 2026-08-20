/**
 * The Design A deployment rehearsal: app sign-in against the portal running in
 * the shipped container, reached through a proxy hop.
 *
 * In production nobody talks to the portal directly. Tailscale Serve terminates
 * TLS and forwards to `127.0.0.1:8080`, so every request arrives from the same
 * socket and the caller's real address survives only in `X-Forwarded-For`. Two
 * things can only break there and nowhere else: the container's own config and
 * environment wiring, and rate limiting collapsing onto the proxy so one phone
 * can lock out every other. This file proves both.
 *
 * As in the in-process suite, the last authorize hop is fetched rather than
 * followed, because no browser resolves `bankimporter://`.
 */

import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { IImporterConfig, IPortalConfig } from '../../src/Types/Index.js';
import { hashPassword } from '../../src/Portal/PortalPassword.js';
import { fakeBankConfig, fakeBankTarget, fakeImporterConfig } from '../helpers/factories.js';
import {
  callApi,
  cookieHeader,
  type IIssuedPair,
  postJson,
  REDIRECT_URI,
  signInWithCookie,
} from './helpers/appAuthClient.js';
import { hasDockerImage } from './helpers/dockerRunner.js';
import { CLIENT_HEADER, type IForwardingProxy, startForwardingProxy } from './helpers/forwardingProxy.js';
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_TEST_EMAIL,
  type IFakeGoogle,
  launchPortalBrowser,
  PORTAL_PASSWORD,
  SESSION_SECRET,
  startFakeGoogle,
} from './helpers/portalHarness.js';
import {
  type IPortalContainer,
  startPortalContainer,
  stopPortalContainer,
  waitForPortal,
} from './helpers/portalDockerRunner.js';

/** Where the container keeps refresh tokens, on the mounted config volume. */
const CONTAINER_TOKENS_PATH = '/app/config/app-tokens.json';

/** Two callers the proxy can pretend to be, from the documentation range. */
const CLIENT_A = '203.0.113.11';
const CLIENT_B = '203.0.113.12';

/** Everything one Dockerized run owns and has to tear down. */
interface IDockerFixture {
  dir: string;
  fake: IFakeGoogle;
  proxy: IForwardingProxy;
  container: IPortalContainer;
  context: BrowserContext;
  page: Page;
}

let browser: Browser;
let fx: IDockerFixture | undefined;

/**
 * Builds the `both`-mode portal block written into the container's config.
 * @param callbackUrl - Google callback URL as the browser will reach it.
 * @returns Portal config with Google, a password and app sign-in enabled.
 */
function portalConfig(callbackUrl: string): IPortalConfig {
  return {
    enabled: true, host: '127.0.0.1', port: 8080,
    authMode: 'both',
    passwordHash: hashPassword(PORTAL_PASSWORD),
    sessionSecret: SESSION_SECRET,
    google: {
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      redirectUri: callbackUrl,
      allowedEmails: [GOOGLE_TEST_EMAIL],
    },
    app: {
      enabled: true,
      redirectUris: [REDIRECT_URI],
      accessTokenTtlMinutes: 15,
      refreshTokenTtlDays: 60,
    },
  };
}

/**
 * Seeds a host directory the container mounts read-write.
 *
 * The Google callback has to be baked in before boot: the container reads the
 * file once at start, so the proxy must already be listening.
 * @param callbackUrl - Google callback URL as the browser will reach it.
 * @returns The seeded directory path.
 */
function seedDir(callbackUrl: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'portal-app-docker-'));
  const configPath = join(dir, 'config.json');
  const portal = portalConfig(callbackUrl);
  const banks = { discount: fakeBankConfig({ targets: [fakeBankTarget()] }) };
  const config: IImporterConfig = fakeImporterConfig({ banks, portal });
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  chmodSync(dir, 0o755);
  chmodSync(configPath, 0o644);
  return dir;
}

/**
 * Builds the container environment for a proxied, app-enabled portal.
 *
 * The two Google endpoints deliberately differ: the browser resolves the
 * consent page on the host loopback, while the container calls the token
 * endpoint back out through the host gateway.
 * @param fake - The running fake identity provider.
 * @returns Environment variables for `docker run`.
 */
function containerEnv(fake: IFakeGoogle): Record<string, string> {
  const port = String(fake.port);
  return {
    // The forwarding proxy runs on the host, so the container sees it arrive
    // from the Docker gateway — a private address, hence `uniquelocal`.
    // `loopback` covers a host-networked daemon.
    PORTAL_TRUST_PROXY: 'uniquelocal,loopback',
    APP_TOKENS_PATH: CONTAINER_TOKENS_PATH,
    GOOGLE_AUTH_BASE: `http://127.0.0.1:${port}/auth`,
    GOOGLE_TOKEN_URL: `http://host.docker.internal:${port}/token`,
  };
}

/**
 * Brings up the fake identity provider, the proxy, the container and a browser.
 * @returns The assembled fixture, parked on the portal login screen.
 */
async function startFixture(): Promise<IDockerFixture> {
  const fake = await startFakeGoogle(GOOGLE_TEST_EMAIL, '0.0.0.0');
  let upstream = '';
  const proxy = await startForwardingProxy(() => upstream);
  const dir = seedDir(`${proxy.baseUrl}/auth/google/callback`);
  const container = startPortalContainer({
    dir, mode: 'rw', hostGateway: true, env: containerEnv(fake),
  });
  upstream = container.baseUrl;
  await waitForPortal(container);
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await page.goto(proxy.baseUrl);
  return { dir, fake, proxy, container, context, page };
}

/**
 * Tears the fixture down, tolerating a run that never got that far.
 * @param fixture - The fixture, when it was built.
 */
async function stopFixture(fixture: IDockerFixture | undefined): Promise<void> {
  if (!fixture) return;
  await fixture.context.close();
  stopPortalContainer(fixture.container.id);
  await fixture.proxy.close();
  await fixture.fake.close();
  rmSync(fixture.dir, { recursive: true, force: true });
}

/**
 * Signs in through the portal UI: Google consent first, then the password.
 * @param page - The portal page served through the proxy.
 */
async function signInToPortal(page: Page): Promise<void> {
  await page.click('#google-btn');
  await page.waitForSelector('#approve', { state: 'visible', timeout: 30_000 });
  await page.click('#approve');
  await page.waitForSelector('#pw', { state: 'visible', timeout: 30_000 });
  await page.fill('#pw', PORTAL_PASSWORD);
  await page.click('#pw-btn');
  await page.waitForSelector('#app', { state: 'visible', timeout: 30_000 });
}

/**
 * Runs one app sign-in against the containerized portal.
 * @param fixture - The running fixture.
 * @param state - State value to round-trip.
 * @returns The issued tokens.
 */
async function appSignIn(fixture: IDockerFixture, state: string): Promise<IIssuedPair> {
  const cookie = await cookieHeader(fixture.context, fixture.proxy.baseUrl);
  return await signInWithCookie(fixture.proxy.baseUrl, cookie, state);
}

/**
 * Posts a deliberately wrong legacy password as a named caller.
 * @param base - Portal base URL (the proxy).
 * @param client - Address the proxy should attribute the call to.
 * @returns The response status.
 */
async function knockOnLegacyToken(base: string, client: string): Promise<number> {
  const headers = { [CLIENT_HEADER]: client };
  const reply = await postJson(`${base}/auth/token`, { password: 'not-the-password' }, headers);
  return reply.status;
}

describe.skipIf(!hasDockerImage())('portal app sign-in inside the container', () => {
  beforeAll(async () => {
    browser = await launchPortalBrowser([1280, 900]);
    fx = await startFixture();
  }, 240_000);

  afterAll(async () => {
    await stopFixture(fx);
    await browser?.close();
  }, 60_000);

  it('issues a working app token through a proxy hop', async () => {
    const fixture = fx as IDockerFixture;
    await signInToPortal(fixture.page);

    const issued = await appSignIn(fixture, 'docker-state-1');
    expect(issued.accessToken.length).toBeGreaterThan(0);
    expect(issued.refreshToken.length).toBeGreaterThan(0);

    const guarded = await callApi(fixture.proxy.baseUrl, '/api/status', issued.accessToken);
    expect(guarded.status).toBe(200);

    const refreshed = await postJson(`${fixture.proxy.baseUrl}/auth/app/refresh`, {
      refreshToken: issued.refreshToken,
    });
    expect(refreshed.status).toBe(200);
    expect(String(refreshed.body.refreshToken)).not.toBe(issued.refreshToken);

    expect(existsSync(join(fixture.dir, 'app-tokens.json'))).toBe(true);
  }, 180_000);

  it('rate limits the forwarded caller, not the proxy', async () => {
    const fixture = fx as IDockerFixture;
    const base = fixture.proxy.baseUrl;
    const seen: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      // Sequential on purpose: the limiter counts requests, and a burst would
      // make "which attempt tripped it" unreadable when this fails.
      seen.push(await knockOnLegacyToken(base, CLIENT_A));
    }
    expect(seen).toContain(429);

    const other = await knockOnLegacyToken(base, CLIENT_B);
    expect(other).not.toBe(429);
  }, 120_000);
});
