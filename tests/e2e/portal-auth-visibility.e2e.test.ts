/**
 * Portal auth-affordance E2E — regression coverage for two reported bugs:
 *
 *  1. "Log out does not work": POST /auth/logout used to be sent with an empty
 *     body AND a content-type of application/json, tripping Fastify's empty-JSON
 *     guard (400), so the session cookie was never cleared. The frontend fix only
 *     declares a JSON content-type when a body exists; this test proves logout
 *     returns 200 and the session is actually gone (a fresh visit lands back on
 *     the login form instead of auto-loading the app).
 *  2. "Google config showed before it was selected": the manifest now gates the
 *     Google OAuth group behind `showWhen: authMode in {google, both}`, so the
 *     group must be hidden under password auth and appear only once the user
 *     switches the auth mode to Google (and hide again when switched back).
 *
 * A real Camoufox (Firefox) browser drives the real served SPA against the real
 * in-process portal server. Always runs — never skipped.
 */

import { rmSync } from 'node:fs';

import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fakeBankConfig, fakeBankTarget, fakeImporterConfig } from '../helpers/factories.js';
import type { IImporterConfig } from '../../src/Types/Index.js';
import { field, node } from './helpers/portalDom.js';
import {
  type IPortalServer, launchPortalBrowser, PORTAL_PASSWORD, startSeededPortal,
} from './helpers/portalHarness.js';

let browser: Browser;

beforeAll(async () => { browser = await launchPortalBrowser(); }, 120_000);
afterAll(async () => { await browser?.close(); });

/**
 * Builds a deterministic, offline-valid seed whose portal section starts in
 * password auth mode but carries a Google OAuth block, so jedison renders the
 * `portal.google` group (jedison only renders a nested object present in the
 * data) while the x-show-when rule keeps it hidden until Google is selected.
 * @returns An importer config the password-mode portal can serve.
 */
function seedConfig(): IImporterConfig {
  return fakeImporterConfig({
    banks: { discount: fakeBankConfig({ targets: [fakeBankTarget()] }) },
    portal: {
      enabled: true, host: '127.0.0.1', port: 8080,
      authMode: 'password', sessionSecret: 'seed-portal-session-secret-0123456789',
      google: {
        clientId: 'seed-client-id', clientSecret: 'seed-client-secret',
        redirectUri: 'https://example.test/auth/google/callback',
        allowedEmails: ['seed@example.com'],
      },
    },
  });
}

/**
 * Opens a fresh desktop context + page parked on the visible login form.
 * @param server - The running portal server.
 * @returns The new context and page.
 */
async function openLogin(server: IPortalServer): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(server.baseUrl);
  await page.waitForSelector('#pw', { state: 'visible' });
  return { context, page };
}

/**
 * Submits the password login form and waits for the authed app shell to render.
 * @param page - Active page on the login screen.
 */
async function loginOk(page: Page): Promise<void> {
  await page.fill('#pw', PORTAL_PASSWORD);
  await page.click('#pw-btn');
  await page.waitForSelector('#app', { state: 'visible' });
}

/**
 * Navigates to a manifest section via the sidebar nav.
 * @param page - Active page.
 * @param key - Section key (e.g. "portal").
 */
async function gotoSection(page: Page, key: string): Promise<void> {
  await page.click(`#nav button[data-section="${key}"]`);
}

/**
 * Tears down whatever setup produced, removing the seeded temp dir.
 *
 * Both arguments may be undefined when a test failed partway through setup; the
 * guards keep teardown a no-op for resources that were never created.
 * @param server - The running portal server, when one was started.
 * @param context - The browser context to close, when one was opened.
 */
async function teardown(
  server: IPortalServer | undefined, context: BrowserContext | undefined,
): Promise<void> {
  if (context) await context.close();
  if (server) {
    await server.app.close();
    rmSync(server.dir, { recursive: true, force: true });
  }
}

describe('Portal auth-affordance E2E', () => {
  it('logs out cleanly (200) and clears the session', async () => {
    let server: IPortalServer | undefined;
    let context: BrowserContext | undefined;
    try {
      server = await startSeededPortal(seedConfig());
      const opened = await openLogin(server);
      context = opened.context;
      const { page } = opened;
      await loginOk(page);

      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/auth/logout')),
        page.click('#logout'),
      ]);
      expect(res.status()).toBe(200);

      // A fresh visit must land on the login form: a still-valid session cookie
      // would auto-load the app shell instead of the password prompt.
      await page.goto(server.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#pw', { state: 'visible' });
      expect(await page.locator('#app').isHidden()).toBe(true);
    } finally {
      await teardown(server, context);
    }
  }, 120_000);

  it('hides the Google OAuth group until auth mode is Google', async () => {
    let server: IPortalServer | undefined;
    let context: BrowserContext | undefined;
    try {
      server = await startSeededPortal(seedConfig());
      const opened = await openLogin(server);
      context = opened.context;
      const { page } = opened;
      await loginOk(page);
      await gotoSection(page, 'portal');
      await field(page, 'portal.authMode').waitFor({ state: 'visible' });

      // Password mode: the Google group is rendered from the seed but the
      // x-show-when rule keeps it hidden (display:none + hidden attribute).
      await node(page, 'portal.google').waitFor({ state: 'hidden' });
      expect(await node(page, 'portal.google').isHidden()).toBe(true);

      // Switch to Google: the group and its client-id field become visible.
      await field(page, 'portal.authMode').selectOption('google');
      await node(page, 'portal.google').waitFor({ state: 'visible' });
      expect(await field(page, 'portal.google.clientId').isVisible()).toBe(true);

      // Switch back to password: the group hides again (still present in the DOM).
      await field(page, 'portal.authMode').selectOption('password');
      await node(page, 'portal.google').waitFor({ state: 'hidden' });
      expect(await node(page, 'portal.google').isHidden()).toBe(true);
    } finally {
      await teardown(server, context);
    }
  }, 120_000);
});
