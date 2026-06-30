/**
 * Portal Google OAuth E2E — validates the `google` auth mode "as a user uses
 * it in real time".
 *
 * A real Camoufox (Firefox) browser drives the real served SPA against the real
 * in-process portal server. Google itself is replaced by a local fake-Google
 * stub (consent page + token endpoint) wired in through the production
 * `GOOGLE_AUTH_BASE`/`GOOGLE_TOKEN_URL` seam, so the WHOLE flow runs: click
 * "Continue with Google" → consent → callback → email allow-list → app shell.
 *
 * Always runs — never skipped. No real Google account or network is required;
 * the same flow works against real Google once an OAuth client is configured.
 */

import { rmSync } from 'node:fs';

import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fakeBankConfig, fakeBankTarget, fakeImporterConfig } from '../helpers/factories.js';
import type { IImporterConfig } from '../../src/Types/Index.js';
import {
  GOOGLE_TEST_EMAIL, type IFakeGoogle, type IGooglePortalServer,
  launchPortalBrowser, startFakeGoogle, startSeededGooglePortal,
} from './helpers/portalHarness.js';

let browser: Browser;

beforeAll(async () => { browser = await launchPortalBrowser(); }, 120_000);
afterAll(async () => { await browser?.close(); });

/**
 * Builds a deterministic, offline-valid seed with one bank + target.
 * @returns An importer config the Google-mode portal can serve.
 */
function seedConfig(): IImporterConfig {
  return fakeImporterConfig({
    banks: { discount: fakeBankConfig({ targets: [fakeBankTarget()] }) },
  });
}

/**
 * Points the production Google endpoints at the fake stub for this test.
 * @param fake - The running fake-Google stub.
 */
function useFakeGoogle(fake: IFakeGoogle): void {
  process.env.GOOGLE_AUTH_BASE = `${fake.base}/auth`;
  process.env.GOOGLE_TOKEN_URL = `${fake.base}/token`;
}

/**
 * Opens a fresh browser context on the Google login screen.
 * @param server - The running Google-mode portal.
 * @returns The new context and page parked on the visible Google button.
 */
async function openGoogleLogin(
  server: IGooglePortalServer,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(server.baseUrl);
  await page.waitForSelector('#google-btn', { state: 'visible' });
  return { context, page };
}

/**
 * Tears down whatever setup produced and clears the Google env seam.
 *
 * Each resource argument may be undefined when a test failed partway through
 * setup; the guards keep teardown a no-op for resources that were never
 * created, while the env seam is always cleared.
 * @param server - The running portal, when one was started.
 * @param context - The browser context to close, when one was opened.
 * @param fake - The fake-Google stub to close, when one was started.
 */
async function teardown(
  server: IGooglePortalServer | undefined,
  context: BrowserContext | undefined,
  fake: IFakeGoogle | undefined,
): Promise<void> {
  if (context) await context.close();
  if (server) {
    await server.app.close();
    rmSync(server.dir, { recursive: true, force: true });
  }
  if (fake) await fake.close();
  delete process.env.GOOGLE_AUTH_BASE;
  delete process.env.GOOGLE_TOKEN_URL;
}

describe('Portal Google OAuth E2E', () => {
  it('signs in through the full Google consent flow and opens the app', async () => {
    let fake: IFakeGoogle | undefined;
    let server: IGooglePortalServer | undefined;
    let context: BrowserContext | undefined;
    try {
      fake = await startFakeGoogle();
      useFakeGoogle(fake);
      server = await startSeededGooglePortal(seedConfig(), {
        allowedEmails: [GOOGLE_TEST_EMAIL],
      });
      const opened = await openGoogleLogin(server);
      context = opened.context;
      const { page } = opened;
      expect(await page.locator('#pw').isHidden()).toBe(true);

      await page.click('#google-btn');
      await page.waitForSelector('#approve', { state: 'visible' });
      await page.click('#approve');

      await page.waitForSelector('#app', { state: 'visible' });
      await page.waitForSelector('#nav button[data-section="banks"]', { state: 'visible' });
      await page.click('#nav button[data-section="banks"]');
      await page.waitForSelector('[data-bank="discount"]', { state: 'visible' });
      expect(await page.locator('[data-bank="discount"]').count()).toBe(1);
    } finally {
      await teardown(server, context, fake);
    }
  }, 120_000);

  it('rejects a Google account that is not on the allow-list', async () => {
    let fake: IFakeGoogle | undefined;
    let server: IGooglePortalServer | undefined;
    let context: BrowserContext | undefined;
    try {
      fake = await startFakeGoogle();
      useFakeGoogle(fake);
      server = await startSeededGooglePortal(seedConfig(), {
        allowedEmails: ['someone-else@example.com'],
      });
      const opened = await openGoogleLogin(server);
      context = opened.context;
      const { page } = opened;
      await page.click('#google-btn');
      await page.waitForSelector('#approve', { state: 'visible' });

      const [response] = await Promise.all([
        page.waitForResponse((res) => res.url().includes('/auth/google/callback')),
        page.click('#approve'),
      ]);

      expect(response.status()).toBe(403);
      expect(await response.json()).toMatchObject({ error: 'Email not allowed' });
      expect(await page.locator('#app').count()).toBe(0);
    } finally {
      await teardown(server, context, fake);
    }
  }, 120_000);
});
