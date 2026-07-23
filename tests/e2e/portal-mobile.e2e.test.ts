/**
 * Portal mobile E2E — validates the responsive **drawer** navigation and that
 * the full edit → save → persist flow works on a phone-sized viewport, exactly
 * as a user on their phone would drive it.
 *
 * The breakpoint is real: Camoufox derives the CSS layout viewport from the
 * browser window, so the harness launches a 390×844 window (not a Playwright
 * emulated viewport, which Camoufox ignores for media queries). Always runs —
 * never skipped; the browser is the product's own Camoufox build.
 */

import { readFileSync, rmSync } from 'node:fs';

import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fakeBankConfig, fakeBankTarget, fakeImporterConfig } from '../helpers/factories.js';
import type { IImporterConfig } from '../../src/Types/Index.js';
import { selectBank } from './helpers/banksPom.js';
import {
  type IPortalServer, launchPortalBrowser, PORTAL_PASSWORD, startSeededPortal,
} from './helpers/portalHarness.js';

const MOBILE: [number, number] = [390, 844];
const DISCOUNT_TARGET_ID = '11111111-1111-4111-8111-111111111111';

let browser: Browser;

beforeAll(async () => { browser = await launchPortalBrowser(MOBILE); }, 120_000);
afterAll(async () => { await browser?.close(); });

/**
 * Builds a deterministic, offline-valid seed with one known "discount" bank.
 * @returns An importer config with a pinned target id.
 */
function seedConfig(): IImporterConfig {
  return fakeImporterConfig({
    banks: {
      discount: fakeBankConfig({
        password: 'disc-secret', daysBack: 10,
        targets: [fakeBankTarget({ actualAccountId: DISCOUNT_TARGET_ID })],
      }),
    },
  });
}

/**
 * Opens a phone-sized context, navigates to the portal, and logs in.
 * @param server - The running portal server.
 * @returns The new context and authed page.
 */
async function openMobileApp(
  server: IPortalServer,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await page.goto(server.baseUrl);
  await page.waitForSelector('#pw', { state: 'visible' });
  await page.fill('#pw', PORTAL_PASSWORD);
  await page.click('#pw-btn');
  await page.waitForSelector('#app', { state: 'visible' });
  return { context, page };
}

/**
 * Tears down whatever setup produced and removes the seeded temp dir.
 *
 * Both arguments may be undefined when a test failed partway through setup
 * (e.g. {@link openMobileApp} timing out); the guards keep teardown a no-op for
 * resources that were never created.
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

/**
 * Reads whether the mobile navigation drawer is currently open.
 * @param page - Active page.
 * @returns True when the app shell has the `nav-open` class.
 */
async function navOpen(page: Page): Promise<boolean> {
  return page.locator('#app').evaluate((el) => el.classList.contains('nav-open'));
}

describe('Portal mobile E2E', () => {
  it('navigates via the drawer, edits, saves, and persists on a phone', async () => {
    let server: IPortalServer | undefined;
    let context: BrowserContext | undefined;
    try {
      server = await startSeededPortal(seedConfig());
      const opened = await openMobileApp(server);
      context = opened.context;
      const { page } = opened;
      // On a phone the hamburger is shown and the drawer starts closed.
      expect(await page.locator('#menu').isVisible()).toBe(true);
      expect(await navOpen(page)).toBe(false);

      // Open the drawer and jump to Banks; selecting a section closes the drawer.
      await page.click('#menu');
      expect(await navOpen(page)).toBe(true);
      await page.click('#nav button[data-section="banks"]');
      await selectBank(page, 'discount');
      expect(await navOpen(page)).toBe(false);

      // Edit a value and save through the sticky top bar.
      await page.locator('[data-path="banks.discount.daysBack"]').fill('25');
      await page.click('#save');
      await page.waitForSelector('#status:has-text("Saved")', { timeout: 15_000 });

      // The phone layout must not overflow horizontally.
      const overflow = await page.locator('html')
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow).toBeLessThanOrEqual(2);

      const cfg = JSON.parse(readFileSync(server.configPath, 'utf8')) as {
        banks?: { discount?: { daysBack?: number } };
      };
      expect(cfg.banks?.discount?.daysBack).toBe(25);
    } finally {
      await teardown(server, context);
    }
  }, 120_000);

  it('closes the drawer when the scrim is tapped', async () => {
    let server: IPortalServer | undefined;
    let context: BrowserContext | undefined;
    try {
      server = await startSeededPortal(seedConfig());
      const opened = await openMobileApp(server);
      context = opened.context;
      const { page } = opened;
      await page.click('#menu');
      expect(await navOpen(page)).toBe(true);
      // Tap the scrim to the right of the drawer (the drawer itself sits on top).
      await page.click('#scrim', { position: { x: 360, y: 420 } });
      expect(await navOpen(page)).toBe(false);
    } finally {
      await teardown(server, context);
    }
  }, 90_000);
});
