/**
 * Portal buttons E2E — per-button validation for the jedison-rendered config
 * portal, covering interactions NOT already exercised by portal-ui /
 * portal-google / portal-mobile.
 *
 * A real Camoufox (Firefox) browser drives the real served SPA against the real
 * in-process portal server, so every assertion reflects what a user actually
 * sees and what is persisted to disk. Each test seeds its own portal, opens its
 * own browser context, and tears everything down in `finally`.
 *
 * Buttons / interactions covered (one focused test each):
 *  1. Enter key in #pw logs in (app.js binds keydown Enter → login()).
 *  2. A target item's jedison "Delete item" button shrinks the targets array.
 *  3. An optional bank field (navigationRetryCount) edits and persists.
 *  4. A translations array's add / delete buttons add and remove an item.
 *  5. A spendingWatch array's add / delete buttons add and remove a rule.
 *  6. A secret input's reveal toggle flips type password ⇄ text.
 *  7. The bank-tools "Validate configuration" button reports a valid config.
 *
 * Design notes / no skips: jedison renders the whole form from the schema, so
 * arrays expose `.jedi-array-add` / `.jedi-array-delete` buttons (deletion is
 * guarded by `window.confirm`, auto-accepted via {@link acceptDialogs}). The
 * translations and spendingWatch object arrays exercise the shared add/remove
 * button path for both scalar and object array items.
 */

import { readFileSync, rmSync } from 'node:fs';

import type { Browser, BrowserContext, Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { fakeBankConfig, fakeBankTarget, fakeImporterConfig } from '../helpers/factories.js';
import type { IImporterConfig } from '../../src/Types/Index.js';
import {
  acceptDialogs, appendArrayItem, arrayDelete, arrayItems, field, node, secretReveal,
} from './helpers/portalDom.js';
import {
  type IPortalServer, launchPortalBrowser, PORTAL_PASSWORD, startSeededPortal,
} from './helpers/portalHarness.js';

const DISCOUNT_PASSWORD = 'discount-secret-xyz';
const TARGET_A = '11111111-1111-4111-8111-111111111111';
const TARGET_B = '22222222-2222-4222-8222-222222222222';
const HEBREW_PAYEE = 'מכולת השכונה';
const ENGLISH_PAYEE = 'Neighborhood Grocery';

/** Minimal typed view of the split config file on disk (settings half). */
interface ISplitFile {
  banks?: Record<string, {
    targets?: unknown[];
    navigationRetryCount?: number;
    password?: string;
  }>;
  spendingWatch?: { alertFromAmount?: number; numOfDayToCount?: number }[];
  categorization?: { translations?: { fromPayee?: string; toPayee?: string }[] };
}

let browser: Browser;

beforeAll(async () => { browser = await launchPortalBrowser(); }, 120_000);
afterAll(async () => { await browser?.close(); });

// Guarantee plaintext credentials regardless of any CREDENTIALS_ENCRYPTION_PASSWORD
// picked up from .env.e2e or a prior test (settings reads stay unaffected either way).
beforeEach(() => { delete process.env.CREDENTIALS_ENCRYPTION_PASSWORD; });

/**
 * Builds a deterministic seed: one known "discount" bank with a single target,
 * plus empty categorization/spendingWatch containers. jedison only renders
 * properties present in the served data, so these arrays must be seeded (as
 * empty) for their add/delete buttons to appear.
 * @returns An importer config with a pinned secret + target.
 */
function seedConfig(): IImporterConfig {
  return fakeImporterConfig({
    banks: {
      discount: fakeBankConfig({
        password: DISCOUNT_PASSWORD,
        daysBack: 10,
        targets: [fakeBankTarget({ actualAccountId: TARGET_A })],
      }),
    },
    categorization: { translations: [] },
    spendingWatch: [],
  });
}

/**
 * Builds a seed whose discount bank carries two valid Actual targets.
 * @returns An importer config used by the target-removal flow.
 */
function seedTwoTargets(): IImporterConfig {
  return fakeImporterConfig({
    banks: {
      discount: fakeBankConfig({
        password: DISCOUNT_PASSWORD,
        daysBack: 10,
        targets: [
          fakeBankTarget({ actualAccountId: TARGET_A }),
          fakeBankTarget({ actualAccountId: TARGET_B }),
        ],
      }),
    },
  });
}

/**
 * Reads and parses the split settings JSON file from disk.
 * @param path - Absolute path to config.json.
 * @returns The parsed structure typed as {@link ISplitFile}.
 */
function readSplit(path: string): ISplitFile {
  return JSON.parse(readFileSync(path, 'utf8')) as ISplitFile;
}

/**
 * Locates a jedison-rendered field control by its dotted config path.
 * @param page - Active page.
 * @param path - Dotted config path, e.g. "banks.discount.password".
 * @returns A locator for that field's input/select.
 */
function byPath(page: Page, path: string): Locator {
  return field(page, path);
}

/**
 * Waits until the status bar reports a fresh successful save.
 *
 * Matches the success class (set only on completion) so a stale "Saved" left by
 * an earlier save in the same test cannot satisfy the wait prematurely.
 * @param page - Active page.
 */
async function expectSaved(page: Page): Promise<void> {
  await page.waitForSelector('#status.ok:has-text("Saved")', { timeout: 15_000 });
}

/**
 * Clicks the global Save button and waits for a fresh success status.
 *
 * The status bar is reset before the click so the wait observes THIS save's
 * completion, never a prior save's leftover "Saved" state (which would let the
 * subsequent disk read race the new write).
 * @param page - Active page on the authed app.
 */
async function save(page: Page): Promise<void> {
  await page.locator('#status').evaluate((el) => {
    el.textContent = '';
    el.setAttribute('class', 'status');
  });
  await page.click('#save');
  await expectSaved(page);
}

/**
 * Scrolls to a schema section via the sidebar nav (jump anchors).
 * @param page - Active page.
 * @param key - Top-level schema section key (e.g. "banks").
 */
async function gotoSection(page: Page, key: string): Promise<void> {
  await page.click(`#nav button[data-section="${key}"]`);
}

/**
 * Scrolls to the Banks section and waits for the seeded discount card.
 * @param page - Active page on the authed app.
 */
async function gotoBanks(page: Page): Promise<void> {
  await gotoSection(page, 'banks');
  await node(page, 'banks.discount').waitFor({ state: 'visible' });
}

/**
 * Opens a fresh desktop context + page parked on the visible login form.
 *
 * Browser dialogs are auto-accepted so jedison's `window.confirm`-guarded array
 * item deletions go through instead of being cancelled by Playwright's default.
 * @param server - The running portal server.
 * @returns The new context and page on the login screen.
 */
async function openLogin(server: IPortalServer): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  acceptDialogs(page);
  await page.goto(server.baseUrl);
  await page.waitForSelector('#pw', { state: 'visible' });
  return { context, page };
}

/**
 * Submits the password login form and waits for the authed app shell.
 * @param page - Active page on the login screen.
 * @param password - Password to submit.
 */
async function loginOk(page: Page, password: string): Promise<void> {
  await page.fill('#pw', password);
  await page.click('#pw-btn');
  await page.waitForSelector('#app', { state: 'visible' });
}

/**
 * Opens a fresh context and logs in with the portal password.
 * @param server - The running portal server.
 * @returns The authed context + page on the app shell.
 */
async function authedPage(server: IPortalServer): Promise<{ context: BrowserContext; page: Page }> {
  const opened = await openLogin(server);
  await loginOk(opened.page, PORTAL_PASSWORD);
  return opened;
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

/**
 * Appends a translations list item and fills the new item's payees.
 * @param page - Active page on the Categories section.
 */
async function addTranslation(page: Page): Promise<void> {
  const index = await appendArrayItem(page, 'categorization.translations');
  await byPath(page, `categorization.translations.${index}.fromPayee`).fill(HEBREW_PAYEE);
  await byPath(page, `categorization.translations.${index}.toPayee`).fill(ENGLISH_PAYEE);
}

/**
 * Asserts exactly one persisted translation matching the given payees.
 * @param server - The running portal server.
 * @param fromPayee - Expected source (Hebrew) payee.
 * @param toPayee - Expected target (English) payee.
 */
function expectTranslation(server: IPortalServer, fromPayee: string, toPayee: string): void {
  const translations = readSplit(server.configPath).categorization?.translations;
  expect(translations).toHaveLength(1);
  expect(translations?.[0]?.fromPayee).toBe(fromPayee);
  expect(translations?.[0]?.toPayee).toBe(toPayee);
}

/**
 * Appends a spending-watch rule and fills its required amount + day window.
 * @param page - Active page on the spending-watch section.
 */
async function addSpendingWatch(page: Page): Promise<void> {
  const index = await appendArrayItem(page, 'spendingWatch');
  await byPath(page, `spendingWatch.${index}.alertFromAmount`).fill('500');
  await byPath(page, `spendingWatch.${index}.numOfDayToCount`).fill('7');
}

/**
 * Asserts exactly one persisted spending-watch rule with the expected values.
 * @param server - The running portal server.
 * @param alertFromAmount - Expected alert threshold.
 * @param numOfDayToCount - Expected day window.
 */
function expectSpendingWatch(
  server: IPortalServer, alertFromAmount: number, numOfDayToCount: number,
): void {
  const rules = readSplit(server.configPath).spendingWatch;
  expect(rules).toHaveLength(1);
  expect(rules?.[0]?.alertFromAmount).toBe(alertFromAmount);
  expect(rules?.[0]?.numOfDayToCount).toBe(numOfDayToCount);
}

describe('Portal buttons E2E', () => {
  it('logs in when Enter is pressed in the password field', async () => {
    const server = await startSeededPortal(seedConfig());
    const { context, page } = await openLogin(server);
    try {
      await page.locator('#pw').fill(PORTAL_PASSWORD);
      await page.locator('#pw').press('Enter');
      await page.waitForSelector('#app', { state: 'visible' });
      expect(await page.locator('#app').isVisible()).toBe(true);
    } finally {
      await teardown(server, context);
    }
  }, 90_000);

  it('removes a bank target and persists the smaller targets array', async () => {
    const server = await startSeededPortal(seedTwoTargets());
    const { context, page } = await authedPage(server);
    try {
      await gotoBanks(page);
      const targets = arrayItems(page, 'banks.discount.targets');
      expect(await targets.count()).toBe(2);

      await arrayDelete(page, 'banks.discount.targets', 1).click();
      await byPath(page, 'banks.discount.targets.1.actualAccountId').waitFor({ state: 'detached' });
      expect(await targets.count()).toBe(1);

      await save(page);
      expect(readSplit(server.configPath).banks?.discount?.targets).toHaveLength(1);
    } finally {
      await teardown(server, context);
    }
  }, 120_000);

  it('edits an optional bank field and persists it', async () => {
    const server = await startSeededPortal(seedConfig());
    const { context, page } = await authedPage(server);
    try {
      await gotoBanks(page);
      const retries = byPath(page, 'banks.discount.navigationRetryCount');
      await retries.waitFor({ state: 'visible' });
      await retries.fill('2');

      await save(page);
      expect(readSplit(server.configPath).banks?.discount?.navigationRetryCount).toBe(2);
    } finally {
      await teardown(server, context);
    }
  }, 120_000);

  it('adds then removes a translation list item, persisting each change', async () => {
    const server = await startSeededPortal(seedConfig());
    const { context, page } = await authedPage(server);
    try {
      await gotoSection(page, 'categorization');
      const items = arrayItems(page, 'categorization.translations');
      expect(await items.count()).toBe(0);

      await addTranslation(page);
      expect(await items.count()).toBe(1);
      await save(page);
      expectTranslation(server, HEBREW_PAYEE, ENGLISH_PAYEE);

      await arrayDelete(page, 'categorization.translations', 0).click();
      await byPath(page, 'categorization.translations.0.fromPayee').waitFor({ state: 'detached' });
      expect(await items.count()).toBe(0);

      await save(page);
      expect(readSplit(server.configPath).categorization?.translations ?? []).toHaveLength(0);
    } finally {
      await teardown(server, context);
    }
  }, 120_000);

  it('adds then removes a spendingWatch rule, persisting each change', async () => {
    const server = await startSeededPortal(seedConfig());
    const { context, page } = await authedPage(server);
    try {
      await gotoSection(page, 'spendingWatch');
      const cards = arrayItems(page, 'spendingWatch');
      expect(await cards.count()).toBe(0);

      await addSpendingWatch(page);
      await save(page);
      expectSpendingWatch(server, 500, 7);

      await arrayDelete(page, 'spendingWatch', 0).click();
      await byPath(page, 'spendingWatch.0.alertFromAmount').waitFor({ state: 'detached' });
      expect(await cards.count()).toBe(0);

      await save(page);
      expect(readSplit(server.configPath).spendingWatch ?? []).toHaveLength(0);
    } finally {
      await teardown(server, context);
    }
  }, 120_000);

  it('toggles a bank secret input between hidden and revealed', async () => {
    const server = await startSeededPortal(seedConfig());
    const { context, page } = await authedPage(server);
    try {
      await gotoBanks(page);
      const secret = byPath(page, 'banks.discount.password');
      const reveal = secretReveal(page, 'banks.discount.password');

      expect(await secret.getAttribute('type')).toBe('password');
      await reveal.click();
      expect(await secret.getAttribute('type')).toBe('text');
      await reveal.click();
      expect(await secret.getAttribute('type')).toBe('password');
    } finally {
      await teardown(server, context);
    }
  }, 120_000);

  it('validates the configuration and reports success in the status bar', async () => {
    const server = await startSeededPortal(seedConfig());
    const { context, page } = await authedPage(server);
    try {
      await page.click('#validate-btn');
      await page.waitForSelector('#status:has-text("Configuration valid")', { timeout: 15_000 });
      expect(await page.locator('#status').textContent()).toContain('valid');
    } finally {
      await teardown(server, context);
    }
  }, 120_000);
});
