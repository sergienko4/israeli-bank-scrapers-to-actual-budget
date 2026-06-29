/**
 * Portal UI E2E — validates the manifest-driven config portal "as a user uses
 * it in real time".
 *
 * A real Camoufox (Firefox) browser drives the real served SPA against the real
 * in-process portal server. The entire UI is rendered from the server's Config
 * Manifest, so these flows also prove the single-source-of-truth design: nav,
 * fields, bank cards, targets and a manifest-only field (delayBetweenBanks) all
 * render + persist with no UI-specific code.
 *
 * Always runs — never skipped. The browser is the product's own Camoufox build.
 */

import { readFileSync, rmSync } from 'node:fs';

import type { Browser, BrowserContext, Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { fakeBankConfig, fakeBankTarget, fakeImporterConfig } from '../helpers/factories.js';
import type { IImporterConfig } from '../../src/Types/Index.js';
import {
  type IPortalServer, launchPortalBrowser, PORTAL_PASSWORD, startSeededPortal,
} from './helpers/portalHarness.js';

const DISCOUNT_PASSWORD = 'discount-secret-xyz';
const DISCOUNT_TARGET_ID = '11111111-1111-4111-8111-111111111111';
const NEW_TARGET_ID = '22222222-2222-4222-8222-222222222222';
const LEUMI_TARGET_ID = '33333333-3333-4333-8333-333333333333';
const MASK = '********';

/** Minimal typed view of the split config/credentials files on disk. */
interface ISplitFile {
  encrypted?: boolean;
  delayBetweenBanks?: number;
  banks?: Record<string, {
    daysBack?: number;
    username?: string;
    password?: string;
    targets?: unknown[];
  }>;
}

let browser: Browser;

beforeAll(async () => { browser = await launchPortalBrowser(); }, 120_000);
afterAll(async () => { await browser?.close(); });

// Guarantee plaintext credentials for non-encryption tests regardless of any
// CREDENTIALS_ENCRYPTION_PASSWORD picked up from .env.e2e or a prior test.
beforeEach(() => { delete process.env.CREDENTIALS_ENCRYPTION_PASSWORD; });

/**
 * Builds a deterministic, offline-valid seed: one known "discount" bank.
 * @returns An importer config with pinned secret + target values.
 */
function seedConfig(): IImporterConfig {
  return fakeImporterConfig({
    banks: {
      discount: fakeBankConfig({
        password: DISCOUNT_PASSWORD,
        daysBack: 10,
        targets: [fakeBankTarget({ actualAccountId: DISCOUNT_TARGET_ID })],
      }),
    },
  });
}

/**
 * Reads and parses a split config/credentials JSON file from disk.
 * @param path - Absolute path to the JSON file.
 * @returns The parsed structure typed as {@link ISplitFile}.
 */
function readSplit(path: string): ISplitFile {
  return JSON.parse(readFileSync(path, 'utf8')) as ISplitFile;
}

/**
 * Locates a field input by its manifest dotted path (data-path attribute).
 * @param page - Active page.
 * @param path - Dotted config path, e.g. "banks.discount.daysBack".
 * @returns A locator for that field's input/select.
 */
function byPath(page: Page, path: string): Locator {
  return page.locator(`[data-path="${path}"]`);
}

/**
 * Waits for an input to render, then asserts its current value.
 * @param locator - Locator resolving to a single input.
 * @param value - Expected input value.
 */
async function expectValue(locator: Locator, value: string): Promise<void> {
  await locator.waitFor({ state: 'visible' });
  expect(await locator.inputValue()).toBe(value);
}

/**
 * Waits until the status bar reports a successful save.
 * @param page - Active page.
 */
async function expectSaved(page: Page): Promise<void> {
  await page.waitForSelector('#status:has-text("Saved")', { timeout: 15_000 });
}

/**
 * Switches to a manifest section via the sidebar nav.
 * @param page - Active page.
 * @param key - Section key (e.g. "banks"; "" for General).
 */
async function gotoSection(page: Page, key: string): Promise<void> {
  await page.click(`#nav button[data-section="${key}"]`);
}

/**
 * Navigates to the Banks section and waits for the seeded discount card.
 * @param page - Active page on the authed app.
 */
async function gotoBanks(page: Page): Promise<void> {
  await gotoSection(page, 'banks');
  await page.locator('[data-bank="discount"]').waitFor({ state: 'visible' });
}

/**
 * Adds a bank through the manifest-driven dropdown + button.
 * @param page - Active page on the Banks section.
 * @param bankId - Supported bank id to add.
 */
async function addBank(page: Page, bankId: string): Promise<void> {
  await page.selectOption('#add-bank-select', bankId);
  await page.click('#add-bank-btn');
  await page.locator(`[data-bank="${bankId}"]`).waitFor({ state: 'visible' });
}

/**
 * Clicks a bank card's "+ Add target" and fills the new target's account id.
 * @param page - Active page.
 * @param bankId - Bank id whose card receives the target.
 * @param accountId - Valid UUID to write into the new target.
 */
async function addTarget(page: Page, bankId: string, accountId: string): Promise<void> {
  const card = page.locator(`[data-bank="${bankId}"]`);
  await card.locator(`[data-add-target="${bankId}"]`).click();
  await card.locator('.target').last()
    .locator('input[data-path$=".actualAccountId"]').fill(accountId);
}

/**
 * Opens a fresh desktop browser context + page pointed at the portal login.
 * @param server - The running portal server.
 * @returns The new context and page (page parked on the visible login form).
 */
async function openLogin(server: IPortalServer): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(server.baseUrl);
  await page.waitForSelector('#pw', { state: 'visible' });
  return { context, page };
}

/**
 * Fills + submits the login form without waiting for success.
 * @param page - Active page on the login screen.
 * @param password - Password to submit.
 */
async function fieldLogin(page: Page, password: string): Promise<void> {
  await page.fill('#pw', password);
  await page.click('#pw-btn');
}

/**
 * Submits the password login form and waits for the authed app shell to render.
 * @param page - Active page on the login screen.
 * @param password - Password to submit.
 */
async function loginOk(page: Page, password: string): Promise<void> {
  await fieldLogin(page, password);
  await page.waitForSelector('#app', { state: 'visible' });
}

/**
 * Re-opens the portal in the same browser context (the session cookie persists),
 * simulating a user returning to the page. Uses a fresh navigation rather than
 * page.reload(), which does not reliably commit in headless Camoufox/Firefox.
 * @param page - Active page.
 * @param server - The running portal server.
 */
async function reopen(page: Page, server: IPortalServer): Promise<void> {
  await page.goto(server.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app', { state: 'visible' });
}

/**
 * Tears down a context + server and removes the seeded temp dir.
 * @param server - The running portal server.
 * @param context - The browser context to close.
 */
async function teardown(server: IPortalServer, context: BrowserContext): Promise<void> {
  await context.close();
  await server.app.close();
  rmSync(server.dir, { recursive: true, force: true });
}

describe('Portal UI E2E', () => {
  it('logs in, edits a field, adds a bank + target, saves, and persists', async () => {
    const server = await startSeededPortal(seedConfig());
    const { context, page } = await openLogin(server);
    try {
      await loginOk(page, PORTAL_PASSWORD);
      await gotoBanks(page);
      await expectValue(byPath(page, 'banks.discount.password'), MASK);

      await byPath(page, 'banks.discount.daysBack').fill('30');
      await addTarget(page, 'discount', NEW_TARGET_ID);

      await addBank(page, 'leumi');
      await byPath(page, 'banks.leumi.username').fill('leumi-user');
      await byPath(page, 'banks.leumi.password').fill('leumi-secret');
      await byPath(page, 'banks.leumi.targets.0.actualAccountId').fill(LEUMI_TARGET_ID);

      await page.click('#save');
      await expectSaved(page);

      await reopen(page, server);
      await gotoBanks(page);
      await expectValue(byPath(page, 'banks.discount.daysBack'), '30');
      await expectValue(byPath(page, 'banks.discount.password'), MASK);
      await page.locator('[data-bank="leumi"]').waitFor({ state: 'visible' });

      const cfg = readSplit(server.configPath);
      const creds = readSplit(server.credsPath);
      expect(cfg.banks?.discount?.daysBack).toBe(30);
      expect(cfg.banks?.discount?.password).toBeUndefined();
      expect(cfg.banks?.leumi).toBeDefined();
      expect(cfg.banks?.discount?.targets).toHaveLength(2);
      expect(creds.banks?.discount?.password).toBe(DISCOUNT_PASSWORD);
      expect(creds.banks?.leumi?.password).toBe('leumi-secret');
    } finally {
      await teardown(server, context);
    }
  }, 120_000);

  it('renders + persists a manifest-only field added with no UI changes', async () => {
    const server = await startSeededPortal(seedConfig());
    const { context, page } = await openLogin(server);
    try {
      await loginOk(page, PORTAL_PASSWORD);

      await gotoSection(page, '');
      await byPath(page, 'delayBetweenBanks').fill('7000');
      await page.click('#save');
      await expectSaved(page);

      await reopen(page, server);
      await gotoSection(page, '');
      await expectValue(byPath(page, 'delayBetweenBanks'), '7000');

      expect(readSplit(server.configPath).delayBetweenBanks).toBe(7000);
    } finally {
      await teardown(server, context);
    }
  }, 120_000);

  it('rejects an incorrect password and keeps the app hidden', async () => {
    const server = await startSeededPortal(seedConfig());
    const { context, page } = await openLogin(server);
    try {
      await fieldLogin(page, 'wrong-password');
      await page.waitForSelector('#login-err:has-text("Invalid")', { timeout: 15_000 });
      expect(await page.locator('#app').isHidden()).toBe(true);
    } finally {
      await teardown(server, context);
    }
  }, 90_000);

  it('encrypts credentials.json when CREDENTIALS_ENCRYPTION_PASSWORD is set', async () => {
    const server = await startSeededPortal(seedConfig());
    const { context, page } = await openLogin(server);
    try {
      await loginOk(page, PORTAL_PASSWORD);
      await gotoBanks(page);
      await byPath(page, 'banks.discount.daysBack').fill('21');

      process.env.CREDENTIALS_ENCRYPTION_PASSWORD = 'e2e-encrypt-pass';
      try {
        await page.click('#save');
        await expectSaved(page);
      } finally {
        delete process.env.CREDENTIALS_ENCRYPTION_PASSWORD;
      }

      const creds = readSplit(server.credsPath);
      const cfg = readSplit(server.configPath);
      expect(creds.encrypted).toBe(true);
      expect(creds.banks).toBeUndefined();
      expect(cfg.banks?.discount?.daysBack).toBe(21);
    } finally {
      await teardown(server, context);
    }
  }, 120_000);

  it('removes a bank and persists its deletion', async () => {
    const server = await startSeededPortal(seedConfig());
    const { context, page } = await openLogin(server);
    try {
      await loginOk(page, PORTAL_PASSWORD);
      await gotoBanks(page);

      await addBank(page, 'hapoalim');
      await page.click('[data-remove-bank="hapoalim"]');
      await page.locator('[data-bank="hapoalim"]').waitFor({ state: 'detached' });
      expect(await page.locator('[data-bank="hapoalim"]').count()).toBe(0);

      await page.click('#save');
      await expectSaved(page);

      const cfg = readSplit(server.configPath);
      expect(cfg.banks?.hapoalim).toBeUndefined();
      expect(cfg.banks?.discount).toBeDefined();
    } finally {
      await teardown(server, context);
    }
  }, 120_000);
});
