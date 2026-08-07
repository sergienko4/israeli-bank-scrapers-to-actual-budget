/**
 * End-to-end mobile-app sign-in against a real portal.
 *
 * This is the proof behind the whole Design A change: a phone can reach a
 * portal that requires Google *and* a password, and end up holding a bearer
 * token that actually opens `/api` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â something the legacy password-only token
 * could never do in `both` mode.
 *
 * The final hop of the authorize flow is fetched rather than followed in the
 * browser on purpose. The portal answers with a redirect to
 * `bankimporter://auth`, and no browser can resolve an app's custom scheme; a
 * real phone hands that URL to the OS instead. Fetching it with the browser's
 * own cookies exercises the identical server path and lets the test read the
 * `Location` header the OS would have received.
 */

import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { IImporterConfig, IPortalAppConfig } from '../../src/Types/Index.js';
import { fakeBankConfig, fakeBankTarget, fakeImporterConfig } from '../helpers/factories.js';
import {
  authorizeUrl,
  authorizeWithCookie,
  callApi,
  codeFrom,
  cookieHeader,
  deleteSession,
  DEVICE_NAME,
  exchange,
  type IIssuedPair,
  pkcePair,
  postJson,
  REDIRECT_URI,
  signInWithCookie,
} from './helpers/appAuthClient.js';
import {
  closeStep,
  GOOGLE_TEST_EMAIL,
  type IFakeGoogle,
  type IGooglePortalServer,
  type IPortalServer,
  launchPortalBrowser,
  PORTAL_PASSWORD,
  quiescePage,
  startFakeGoogle,
  startSeededGooglePortal,
  startSeededPortal,
} from './helpers/portalHarness.js';

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
  if (browser) await closeStep('browser', () => browser.close());
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
 * Requests an authorization code with the signed-in browser's cookies, without
 * following the redirect into the app's custom scheme.
 * @param fx - Signed-in fixture.
 * @param url - Authorize URL to request.
 * @returns The unfollowed response.
 */
async function authorizeAsUser(fx: IAppFixture, url: string): Promise<Response> {
  const cookie = await cookieHeader(fx.context, fx.server.baseUrl);
  return await authorizeWithCookie(url, cookie);
}

/**
 * Runs one signed-in app sign-in and returns the tokens it produced.
 * @param fx - A fixture whose page is already past the portal login.
 * @param state - The state value to round-trip.
 * @returns The access token, refresh token and session id.
 */
async function signIn(fx: IAppFixture, state: string): Promise<IIssuedPair> {
  const cookie = await cookieHeader(fx.context, fx.server.baseUrl);
  return await signInWithCookie(fx.server.baseUrl, cookie, state);
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
    // The page that failed may be mid-navigation, which is precisely the state
    // that can wedge a context close, so this path needs the deadline too.
    const startedContext = context;
    const startedServer = server;
    if (startedContext) {
      await closeStep('browser context', () => startedContext.close()).catch(() => undefined);
    }
    if (startedServer) {
      await closeStep('portal server', () => startedServer.app.close()).catch(() => undefined);
    }
    await closeStep('fake Google', () => fake.close()).catch(() => undefined);
    throw error;
  }
}

/**
 * Runs every close under its own deadline, then reports the first failure.
 *
 * Each step is attempted even when an earlier one fails, so a wedged browser
 * context can no longer strand the servers behind it — the leak that turns one
 * stuck resource into a port still held by the next test file.
 * @param steps - Labelled closes, outermost resource first.
 * @returns Resolves when all steps settled; rejects with the first failure.
 */
async function runCloses(
  steps: ReadonlyArray<readonly [string, () => Promise<unknown>]>,
): Promise<void> {
  const failures: unknown[] = [];
  for (const [label, close] of steps) {
    await closeStep(label, close).catch((error: unknown) => {
      failures.push(error);
    });
  }
  if (failures.length > 0) throw failures[0];
}

/**
 * Tears down a plain app fixture, tolerating a partially built one.
 * @param fx - The fixture, when it was created.
 */
async function stopAppFixture(fx: IAppFixture | undefined): Promise<void> {
  if (!fx) return;
  await quiescePage(fx.page);
  await runCloses([
    ['browser context', () => fx.context.close()],
    ['portal server', () => fx.server.app.close()],
  ]);
}

/**
 * Tears down a Google fixture, tolerating a partially built one.
 * @param fx - The fixture, when it was created.
 */
async function stopGoogleFixture(fx: IGoogleFixture | undefined): Promise<void> {
  if (!fx) return;
  await quiescePage(fx.page);
  await runCloses([
    ['browser context', () => fx.context.close()],
    ['portal server', () => fx.server.app.close()],
    ['fake Google', () => fx.fake.close()],
  ]);
}

describe('portal app sign-in (both mode)', () => {
  let envBackup: IGoogleEnvBackup;
  let fx: IGoogleFixture;

  beforeAll(async () => {
    envBackup = backupGoogleEnv();
    fx = await startGoogleFixture();
    // Every test here authorizes as a signed-in user. Signing in once, up here,
    // is what lets any of them run alone: while this lived inside the first
    // test, the rest only passed because that one had already run.
    await approveGoogle(fx.page);
    await submitPassword(fx.page);
    await fx.page.waitForSelector('#app', { state: 'visible', timeout: 30_000 });
  }, 120_000);

  afterAll(async () => {
    try {
      await stopGoogleFixture(fx);
    } finally {
      // Restoring must survive a failed teardown: when the close below hung,
      // these overrides leaked into every later suite in the same worker.
      restoreGoogleEnv(envBackup);
    }
  }, 60_000);

  it('carries the app from authorize to a working access token', async () => {
    const { verifier, challenge } = pkcePair();
    const state = 'e2e-state-happy-path';
    const url = authorizeUrl({ base: fx.server.baseUrl, challenge, state });

    // An authorized browser gets a single-use code on the app's own scheme.
    const granted = await authorizeAsUser(fx, url);
    expect(granted.status).toBe(302);
    const location = granted.headers.get('location') ?? '';
    expect(location.startsWith(`${REDIRECT_URI}?code=`)).toBe(true);
    const handed = codeFrom(location);
    expect(handed.state).toBe(state);
    expect(handed.code.length).toBeGreaterThan(20);

    // The code buys a token pair.
    const issued = await exchange({ base: fx.server.baseUrl, code: handed.code, verifier });
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
    const url = authorizeUrl({
      base: fx.server.baseUrl, challenge: mine.challenge, state: 'e2e-state-wrong-verifier',
    });
    const granted = await authorizeAsUser(fx, url);
    expect(granted.status).toBe(302);
    const handed = codeFrom(granted.headers.get('location') ?? '');

    const stolen = await exchange({
      base: fx.server.baseUrl, code: handed.code, verifier: attacker.verifier,
    });
    expect(stolen.status).toBe(400);
    expect(stolen.body.error).toBe('invalid_grant');

    // The code is spent either way, so the honest holder cannot recover it.
    const honest = await exchange({
      base: fx.server.baseUrl, code: handed.code, verifier: mine.verifier,
    });
    expect(honest.status).toBe(400);
  }, 120_000);

  it('treats a replayed code as a breach and kills what it issued', async () => {
    const { verifier, challenge } = pkcePair();
    const url = authorizeUrl({ base: fx.server.baseUrl, challenge, state: 'e2e-state-replay' });
    const granted = await authorizeAsUser(fx, url);
    const handed = codeFrom(granted.headers.get('location') ?? '');

    const first = await exchange({ base: fx.server.baseUrl, code: handed.code, verifier });
    expect(first.status).toBe(200);
    const refreshToken = String(first.body.refreshToken);

    const second = await exchange({ base: fx.server.baseUrl, code: handed.code, verifier });
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
    const url = authorizeUrl({
      base: fx.server.baseUrl,
      challenge,
      state: 'e2e-state-bad-redirect',
      redirectUri: 'bankimporter://stolen',
    });
    const refused = await authorizeAsUser(fx, url);
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { error: string };
    expect(body.error).toBe('invalid_redirect_uri');
  }, 120_000);

  it('refuses a malformed state and echoes a good one unchanged', async () => {
    const { challenge } = pkcePair();
    const bad = authorizeUrl({
      base: fx.server.baseUrl, challenge, state: 'has spaces and <angles>',
    });
    const refused = await authorizeAsUser(fx, bad);
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { error: string };
    expect(body.error).toBe('invalid_state');

    // The app compares what comes back against what it sent, so the portal
    // must return the value byte for byte.
    const state = 'e2e-state~echo.check-1';
    const good = authorizeUrl({ base: fx.server.baseUrl, challenge, state });
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
    await stopAppFixture(fx);
  }, 60_000);

  it('stops honouring a password-era token once both factors are required', async () => {
    const { verifier, challenge } = pkcePair();
    const url = authorizeUrl({
      base: fx.server.baseUrl, challenge, state: 'e2e-state-mode-change',
    });

    await submitPassword(fx.page);
    await fx.page.waitForSelector('#app', { state: 'visible', timeout: 30_000 });

    const granted = await authorizeAsUser(fx, url);
    expect(granted.status).toBe(302);
    const handed = codeFrom(granted.headers.get('location') ?? '');
    const issued = await exchange({ base: fx.server.baseUrl, code: handed.code, verifier });
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

describe('portal app sign-out', () => {
  let fx: IAppFixture;

  beforeAll(async () => {
    const server = await startSeededPortal(seedConfig(), appConfig());
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    await page.goto(server.baseUrl);
    await submitPassword(page);
    await page.waitForSelector('#app', { state: 'visible', timeout: 30_000 });
    fx = { server, context, page };
  }, 120_000);

  afterAll(async () => {
    await stopAppFixture(fx);
  }, 60_000);

  it('ends a session the phone hands back', async () => {
    const issued = await signIn(fx, 'e2e-state-revoke');

    const done = await postJson(`${fx.server.baseUrl}/auth/app/revoke`, {
      refreshToken: issued.refreshToken,
    });
    expect(done.status).toBe(200);
    expect(done.body.ok).toBe(true);

    // The access token is a signed claim, not a database row, so it keeps
    // working until it expires. Revoking ends the ability to renew it.
    const still = await callApi(fx.server.baseUrl, '/api/status', issued.accessToken);
    expect(still.status).toBe(200);
    const refused = await postJson(`${fx.server.baseUrl}/auth/app/refresh`, {
      refreshToken: issued.refreshToken,
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('invalid_grant');
  }, 120_000);

  it('says nothing about a token it has never seen', async () => {
    const unknown = await postJson(`${fx.server.baseUrl}/auth/app/revoke`, {
      refreshToken: 'not-a-token-this-portal-ever-issued',
    });
    expect(unknown.status).toBe(200);
    expect(unknown.body.ok).toBe(true);
  }, 120_000);

  it('ends a session the owner picks off the list', async () => {
    const issued = await signIn(fx, 'e2e-state-remote-revoke');

    const gone = await deleteSession(fx.server.baseUrl, issued.sessionId, issued.accessToken);
    expect(gone.status).toBe(200);

    const refused = await postJson(`${fx.server.baseUrl}/auth/app/refresh`, {
      refreshToken: issued.refreshToken,
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('invalid_grant');

    const missing = await deleteSession(
      fx.server.baseUrl,
      'AAAAAAAAAAAAAAAAAAAAAA',
      issued.accessToken,
    );
    expect(missing.status).toBe(404);
  }, 120_000);
});

describe('portal app sign-in from the parked authorize URL', () => {
  let envBackup: IGoogleEnvBackup;
  let fx: IGoogleFixture;

  beforeAll(async () => {
    envBackup = backupGoogleEnv();
    fx = await startGoogleFixture();
  }, 120_000);

  afterAll(async () => {
    try {
      await stopGoogleFixture(fx);
    } finally {
      restoreGoogleEnv(envBackup);
    }
  }, 60_000);

  it('returns to the app sign-in instead of settling on the dashboard', async () => {
    const { challenge } = pkcePair();
    const state = 'e2e-state-bounce';
    const url = authorizeUrl({ base: fx.server.baseUrl, challenge, state });

    // This fixture stays on the parked URL, which the happy path deliberately
    // leaves. Without that, nothing exercises what a phone depends on: Google's
    // callback returns to `/` carrying no query string, so the destination has
    // to survive the round trip some other way or the browser settles on the
    // dashboard and the app waits for a code that never comes.
    await fx.page.goto(url);
    await fx.page.waitForSelector('#google-btn', { state: 'visible', timeout: 30_000 });

    const bounced = fx.page.waitForRequest(
      (request) => request.url().includes('/auth/app/authorize'),
      { timeout: 60_000 },
    );
    await approveGoogle(fx.page);
    await submitPassword(fx.page);

    const request = await bounced;
    expect(request.url()).toContain(`code_challenge=${challenge}`);
    expect(request.url()).toContain(`state=${state}`);

    // `waitForRequest` resolves the moment the request is issued, so without
    // this the test returns while the page is still navigating — and a page
    // caught mid-navigation is what lets Firefox decline the window close that
    // `context.close()` then waits on forever. Landing the redirect also
    // asserts where the bounce actually ends up, which nothing else here did.
    await fx.page.waitForURL(/\/approve\.html/, { timeout: 30_000 });
  }, 120_000);
});
