/**
 * Portal buttons E2E — per-button validation for the manifest-driven config
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
 *  2. A target row's "Remove target" button shrinks the targets array.
 *  3. The per-bank `select[data-add-field]` adds an optional catalog field.
 *  4. A list field's "+ Add" / "✕" buttons add and remove an item.
 *  5. A `list` section's "+ Add" primary button and a card's "Remove" button.
 *  6. A secret input's reveal toggle flips type password ⇄ text.
 *  7. A section `doc` renders a safe external "Read the documentation" link.
 *  8. Add-bank happy path: select + add + fill required + valid target UUID +
 *     Save persists the bank with its secret split into credentials.json.
 *  9. Add-bank with no selection gives a toast and adds no card.
 * 10. Saving an incomplete bank surfaces a per-field problem list, flags the
 *     offending inputs (aria-invalid), and persists nothing.
 * 11. Changing a bank password persists the NEW secret to credentials.json.
 *
 * Design notes / no skips: every gap has real manifest support, so nothing is
 * skipped. For test 4 the representative non-Google list field is the OBJECT
 * list `categorization.translations` (reachable directly in the Categories
 * section): the only pure-scalar lists are the Google-only `allowedEmails`
 * (hidden unless authMode is google) and `spendingWatch.watchPayees` (nested in
 * the section-list already covered by test 5). The add/remove buttons share one
 * code path (`listFieldNode` / `listItemNode`) for scalar and object lists, so
 * the object list fully exercises the buttons under test.
 */

import { readFileSync, rmSync } from 'node:fs';

import type { Browser, BrowserContext, Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { fakeBankConfig, fakeBankTarget, fakeImporterConfig } from '../helpers/factories.js';
import type { IImporterConfig } from '../../src/Types/Index.js';
import {
  type IPortalServer, launchPortalBrowser, PORTAL_PASSWORD, startSeededPortal,
} from './helpers/portalHarness.js';

/** Base GitHub docs URL the portal builds every section doc link from. */
const DOC_BASE =
  'https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/';

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
    username?: string;
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
 * Builds a deterministic seed: one known "discount" bank with a single target.
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
 * Locates a field control by its manifest dotted path (data-path attribute).
 * @param page - Active page.
 * @param path - Dotted config path, e.g. "banks.discount.password".
 * @returns A locator for that field's input/select.
 */
function byPath(page: Page, path: string): Locator {
  return page.locator(`[data-path="${path}"]`);
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
 * Opens a fresh desktop context + page parked on the visible login form.
 * @param server - The running portal server.
 * @returns The new context and page on the login screen.
 */
async function openLogin(server: IPortalServer): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
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
 * Clicks the translations "+ Add" button and fills the new item's payees.
 * @param page - Active page on the Categories section.
 */
async function addTranslation(page: Page): Promise<void> {
  await page.click('[data-add="categorization.translations"]');
  await byPath(page, 'categorization.translations.0.fromPayee').fill(HEBREW_PAYEE);
  await byPath(page, 'categorization.translations.0.toPayee').fill(ENGLISH_PAYEE);
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
 * Clicks "+ Add Watch" and fills the new rule's required amount + day window.
 * @param page - Active page on the spending-watch section.
 */
async function addSpendingWatch(page: Page): Promise<void> {
  await page.click('[data-add="spendingWatch"]');
  await byPath(page, 'spendingWatch.0.alertFromAmount').fill('500');
  await byPath(page, 'spendingWatch.0.numOfDayToCount').fill('7');
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
      const targets = page.locator('[data-bank="discount"] .target');
      expect(await targets.count()).toBe(2);

      await targets.last().locator('button:has-text("Remove target")').click();
      await byPath(page, 'banks.discount.targets.1').waitFor({ state: 'detached' });
      expect(await targets.count()).toBe(1);

      await save(page);
      expect(readSplit(server.configPath).banks?.discount?.targets).toHaveLength(1);
    } finally {
      await teardown(server, context);
    }
  }, 120_000);

  it('adds an optional bank field via the add-field dropdown and persists it', async () => {
    const server = await startSeededPortal(seedConfig());
    const { context, page } = await authedPage(server);
    try {
      await gotoBanks(page);
      const field = byPath(page, 'banks.discount.navigationRetryCount');
      expect(await field.count()).toBe(0);

      await page.selectOption('select[data-add-field="discount"]', 'navigationRetryCount');
      await field.waitFor({ state: 'visible' });
      await field.fill('2');

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
      const items = page.locator('[data-path="categorization.translations"] .list-item');
      expect(await items.count()).toBe(0);

      await addTranslation(page);
      expect(await items.count()).toBe(1);
      await save(page);
      expectTranslation(server, HEBREW_PAYEE, ENGLISH_PAYEE);

      await items.first().locator('button.danger').click();
      await byPath(page, 'categorization.translations.0.fromPayee').waitFor({ state: 'detached' });
      expect(await items.count()).toBe(0);

      await save(page);
      expect(readSplit(server.configPath).categorization?.translations ?? []).toHaveLength(0);
    } finally {
      await teardown(server, context);
    }
  }, 120_000);

  it('adds then removes a spendingWatch section card, persisting each change', async () => {
    const server = await startSeededPortal(seedConfig());
    const { context, page } = await authedPage(server);
    try {
      await gotoSection(page, 'spendingWatch');
      const cards = page.locator('[data-item^="spendingWatch."]');
      expect(await cards.count()).toBe(0);

      await addSpendingWatch(page);
      await save(page);
      expectSpendingWatch(server, 500, 7);

      await page.locator('[data-item="spendingWatch.0"] .card-head button').click();
      await page.locator('[data-item="spendingWatch.0"]').waitFor({ state: 'detached' });
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
      const reveal = page.locator('[data-bank="discount"] .secret')
        .filter({ has: secret }).locator('button.reveal');

      expect(await secret.getAttribute('type')).toBe('password');
      await reveal.click();
      expect(await secret.getAttribute('type')).toBe('text');
      await reveal.click();
      expect(await secret.getAttribute('type')).toBe('password');
    } finally {
      await teardown(server, context);
    }
  }, 120_000);

  it('renders a documentation link with safe external-link attributes', async () => {
    const server = await startSeededPortal(seedConfig());
    const { context, page } = await authedPage(server);
    try {
      await gotoBanks(page);
      const doc = page.locator('#view a.doc');
      await doc.waitFor({ state: 'visible' });

      expect(await doc.getAttribute('target')).toBe('_blank');
      expect(await doc.getAttribute('rel')).toBe('noopener');
      const href = await doc.getAttribute('href');
      expect(href?.startsWith(DOC_BASE)).toBe(true);
      expect(href?.endsWith('configuration/banks.md')).toBe(true);
    } finally {
      await teardown(server, context);
    }
  }, 120_000);

  it('adds a bank via the dropdown, fills its fields + target, and persists it (secret split out)',
    async () => {
      const server = await startSeededPortal(seedConfig());
      const { context, page } = await authedPage(server);
      try {
        await gotoBanks(page);
        expect(await page.locator('[data-bank="leumi"]').count()).toBe(0);

        await page.selectOption('#add-bank-select', 'leumi');
        await page.click('#add-bank-btn');
        await page.locator('[data-bank="leumi"]').waitFor({ state: 'visible' });

        await byPath(page, 'banks.leumi.username').fill('leumi-user');
        await byPath(page, 'banks.leumi.password').fill('leumi-secret-42');
        await byPath(page, 'banks.leumi.targets.0.actualAccountId').fill(TARGET_B);

        await save(page);

        // The settings half keeps the bank + target but NOT the plaintext secret.
        const settings = readSplit(server.configPath);
        expect(settings.banks?.leumi?.targets).toHaveLength(1);
        expect(settings.banks?.leumi?.password).toBeUndefined();
        // The secret is split out into the credentials half.
        expect(readSplit(server.credsPath).banks?.leumi?.password).toBe('leumi-secret-42');
      } finally {
        await teardown(server, context);
      }
    }, 120_000);

  it('gives feedback and adds no card when Add bank is clicked with no selection', async () => {
    const server = await startSeededPortal(seedConfig());
    const { context, page } = await authedPage(server);
    try {
      await gotoBanks(page);
      const cards = page.locator('.card[data-bank]');
      const before = await cards.count();

      await page.click('#add-bank-btn'); // placeholder still selected
      await page.waitForSelector('.toast.err', { state: 'visible' });
      expect(await page.locator('.toast.err').first().textContent()).toContain('Select a bank');
      expect(await cards.count()).toBe(before);
    } finally {
      await teardown(server, context);
    }
  }, 120_000);

  it('surfaces which fields are missing when an incomplete bank is saved, persisting nothing',
    async () => {
      const server = await startSeededPortal(seedConfig());
      const { context, page } = await authedPage(server);
      try {
        await gotoBanks(page);
        await page.selectOption('#add-bank-select', 'leumi');
        await page.click('#add-bank-btn');
        await page.locator('[data-bank="leumi"]').waitFor({ state: 'visible' });

        // Save with leumi's required credentials + target account left empty.
        await page.locator('#status').evaluate((node) => {
          node.textContent = '';
          node.setAttribute('class', 'status');
        });
        await page.click('#save');
        await page.waitForSelector('#status.err', { timeout: 15_000 });

        // A readable per-problem list is shown, not one opaque semicolon line.
        expect(await page.locator('#status .error-list li').count()).toBeGreaterThan(0);
        // The empty required inputs + target account are flagged for the user.
        expect(await byPath(page, 'banks.leumi.username').getAttribute('aria-invalid')).toBe('true');
        expect(await byPath(page, 'banks.leumi.targets.0.actualAccountId')
          .getAttribute('aria-invalid')).toBe('true');

        // Nothing persisted: disk still carries only the seeded discount bank.
        const settings = readSplit(server.configPath);
        expect(settings.banks?.leumi).toBeUndefined();
        expect(settings.banks?.discount).toBeDefined();
      } finally {
        await teardown(server, context);
      }
    }, 120_000);

  it('persists a changed bank password as the new secret in credentials.json', async () => {
    const server = await startSeededPortal(seedConfig());
    const { context, page } = await authedPage(server);
    try {
      await gotoBanks(page);
      await byPath(page, 'banks.discount.password').fill('NEW-password-123');
      await save(page);
      expect(readSplit(server.credsPath).banks?.discount?.password).toBe('NEW-password-123');
    } finally {
      await teardown(server, context);
    }
  }, 120_000);
});
