/**
 * Portal `both` auth mode: Google AND password are both required. Verifies the
 * UI guides the user through whichever factor remains — in either order — and
 * opens the app only once both factors are satisfied. The previously broken
 * behavior re-showed an identical login form (no sign of progress), and a
 * correct password entered first surfaced a misleading "Unauthorized" error.
 */

import { rmSync } from 'node:fs';

import type { Browser, BrowserContext, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { IImporterConfig } from '../../src/Types/Index.js';
import { fakeBankConfig, fakeBankTarget, fakeImporterConfig } from '../helpers/factories.js';
import {
  GOOGLE_TEST_EMAIL, type IFakeGoogle, type IGooglePortalServer,
  launchPortalBrowser, PORTAL_PASSWORD, startFakeGoogle, startSeededGooglePortal,
} from './helpers/portalHarness.js';

let browser: Browser;

beforeAll(async () => { browser = await launchPortalBrowser(); }, 120_000);
afterAll(async () => { await browser?.close(); });

/** A running both-mode portal + fake Google + a fresh browser page. */
interface IBothFixture {
  server: IGooglePortalServer;
  fake: IFakeGoogle;
  context: BrowserContext;
  page: Page;
}

/** Snapshot of the Google endpoint env vars a both-mode test overrides. */
interface IGoogleEnvBackup {
  authBase: string | undefined;
  tokenUrl: string | undefined;
}

/**
 * Captures the current Google endpoint env vars before a test overrides them.
 *
 * Both-mode tests repoint {@code GOOGLE_AUTH_BASE}/{@code GOOGLE_TOKEN_URL} at a
 * fake stub; snapshotting first lets teardown restore (not erase) any value a
 * surrounding worker had already set.
 * @returns The pre-test values, each undefined when its var was unset.
 */
function backupGoogleEnv(): IGoogleEnvBackup {
  return {
    authBase: process.env.GOOGLE_AUTH_BASE,
    tokenUrl: process.env.GOOGLE_TOKEN_URL,
  };
}

/**
 * Restores a Google endpoint env snapshot, unsetting vars that were unset.
 * @param backup - The snapshot captured by {@link backupGoogleEnv}.
 */
function restoreGoogleEnv(backup: IGoogleEnvBackup): void {
  if (backup.authBase === undefined) delete process.env.GOOGLE_AUTH_BASE;
  else process.env.GOOGLE_AUTH_BASE = backup.authBase;
  if (backup.tokenUrl === undefined) delete process.env.GOOGLE_TOKEN_URL;
  else process.env.GOOGLE_TOKEN_URL = backup.tokenUrl;
}

/**
 * Builds an offline-valid seed with one bank + target.
 * @returns Importer config for the both-mode portal.
 */
function seedConfig(): IImporterConfig {
  return fakeImporterConfig({
    banks: { discount: fakeBankConfig({ targets: [fakeBankTarget()] }) },
  });
}

/**
 * Starts a fake Google, a both-mode portal pointed at it, and a browser page.
 * @returns The assembled fixture.
 */
async function startBoth(): Promise<IBothFixture> {
  const fake = await startFakeGoogle();
  process.env.GOOGLE_AUTH_BASE = `${fake.base}/auth`;
  process.env.GOOGLE_TOKEN_URL = `${fake.base}/token`;
  const server = await startSeededGooglePortal(seedConfig(), {
    allowedEmails: [GOOGLE_TEST_EMAIL], authMode: 'both',
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(server.baseUrl);
  return { server, fake, context, page };
}

/**
 * Tears down the fixture: browser context, servers, and seeded temp dir.
 *
 * The argument may be undefined when a test failed before the fixture was
 * assembled; the early return keeps teardown a no-op in that case. Env
 * restoration is handled by the caller's {@link restoreGoogleEnv}.
 * @param fx - The fixture to dispose, when one was created.
 */
async function stopBoth(fx: IBothFixture | undefined): Promise<void> {
  if (!fx) return;
  await fx.context.close();
  await fx.server.app.close();
  await fx.fake.close();
  rmSync(fx.server.dir, { recursive: true, force: true });
}

/**
 * Completes the fake-Google consent flow starting from the login screen.
 * @param page - The portal page.
 */
async function approveGoogle(page: Page): Promise<void> {
  await page.click('#google-btn');
  await page.waitForSelector('#approve', { state: 'visible' });
  await page.click('#approve');
}

describe('Portal both-mode auth', () => {
  it('google first: acknowledges Google, then asks for the password', async () => {
    const envBackup = backupGoogleEnv();
    let fx: IBothFixture | undefined;
    try {
      fx = await startBoth();
      await fx.page.waitForSelector('#google-btn', { state: 'visible' });
      expect(await fx.page.locator('#pw').isVisible()).toBe(true);

      await approveGoogle(fx.page);

      await fx.page.waitForSelector('#pw', { state: 'visible' });
      expect(await fx.page.locator('#app').isHidden()).toBe(true);
      expect(await fx.page.locator('#google-btn').isHidden()).toBe(true);
      const hint = await fx.page.locator('#login-hint').textContent();
      expect(hint).toContain('✓ Signed in');
      expect(hint).toContain(GOOGLE_TEST_EMAIL);

      await fx.page.fill('#pw', PORTAL_PASSWORD);
      await fx.page.click('#pw-btn');
      await fx.page.waitForSelector('#app', { state: 'visible', timeout: 15_000 });
    } finally {
      restoreGoogleEnv(envBackup);
      await stopBoth(fx);
    }
  }, 120_000);

  it('password first: accepts the password without error, then asks for Google', async () => {
    const envBackup = backupGoogleEnv();
    let fx: IBothFixture | undefined;
    try {
      fx = await startBoth();
      await fx.page.waitForSelector('#pw', { state: 'visible' });
      await fx.page.fill('#pw', PORTAL_PASSWORD);
      await fx.page.click('#pw-btn');

      await fx.page.waitForSelector('#pw', { state: 'hidden' });
      expect(await fx.page.locator('#app').isHidden()).toBe(true);
      expect(await fx.page.locator('#google-btn').isVisible()).toBe(true);
      expect((await fx.page.locator('#login-err').textContent()) ?? '').toBe('');
      const hint = await fx.page.locator('#login-hint').textContent();
      expect(hint).toContain('✓ Password accepted');

      await approveGoogle(fx.page);
      await fx.page.waitForSelector('#app', { state: 'visible', timeout: 15_000 });
    } finally {
      restoreGoogleEnv(envBackup);
      await stopBoth(fx);
    }
  }, 120_000);
});
