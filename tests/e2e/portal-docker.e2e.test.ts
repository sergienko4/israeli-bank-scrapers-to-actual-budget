/**
 * Portal Docker E2E proves the config web portal round-trips through a Docker
 * directory-mounted volume while preserving least privilege: the importer can
 * consume a read-only mount, and the portal needs read-write access to save.
 */

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Browser, BrowserContext, Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { IImporterConfig, IPortalConfig } from '../../src/Types/Index.js';
import { hashPassword } from '../../src/Portal/PortalPassword.js';
import { fakeBankConfig, fakeBankTarget, fakeImporterConfig } from '../helpers/factories.js';
import { hasDockerImage } from './helpers/dockerRunner.js';
import { gotoBanks } from './helpers/banksPom.js';
import { launchPortalBrowser, setValue } from './helpers/portalHarness.js';
import {
  type IPortalContainer,
  startPortalContainer,
  stopPortalContainer,
  waitForPortal,
} from './helpers/portalDockerRunner.js';

const PASSWORD = 'e2e-docker-portal-pass-7731';
const SESSION_SECRET = 'e2e-docker-portal-session-secret-0123';
const DISCOUNT_SECRET = 'discount-secret';

/** Directory and file paths seeded for a Docker portal run. */
interface ISeededDir {
  dir: string;
  configPath: string;
  credsPath: string;
}

/** Minimal typed view of the split config/credentials files on disk. */
interface ISplitFile {
  banks?: Record<string, { daysBack?: number; password?: string }>;
}

let browser: Browser;

/**
 * Launches the shared portal browser for this Docker E2E file.
 * @returns Resolves after the browser is ready.
 */
async function launchBrowser(): Promise<void> {
  browser = await launchPortalBrowser([1280, 900]);
}

/**
 * Closes the shared portal browser after all Docker E2E cases finish.
 * @returns Resolves after browser teardown completes.
 */
async function closeBrowser(): Promise<void> {
  await browser.close();
}

/**
 * Creates a password-mode portal block for the seeded config file.
 * @returns Portal configuration with a hashed password and strong session secret.
 */
function portalConfig(): IPortalConfig {
  const passwordHash = hashPassword(PASSWORD);
  return {
    enabled: true, host: '127.0.0.1', port: 8080,
    authMode: 'password', passwordHash, sessionSecret: SESSION_SECRET,
  };
}

/**
 * Builds the importer config persisted into the Docker bind-mounted directory.
 * @returns Importer config with one deterministic Discount bank and portal auth.
 */
function seedConfig(): IImporterConfig {
  const target = fakeBankTarget();
  const discount = fakeBankConfig({ daysBack: 10, password: DISCOUNT_SECRET, targets: [target] });
  const portal = portalConfig();
  return fakeImporterConfig({ banks: { discount }, portal });
}

/**
 * Creates a fresh host directory containing a Docker portal config.json.
 * @returns Directory and sibling config/credentials paths for assertions.
 */
function seedDir(): ISeededDir {
  const dir = mkdtempSync(join(tmpdir(), 'portal-docker-'));
  const configPath = join(dir, 'config.json');
  const credsPath = join(dir, 'credentials.json');
  const config = seedConfig();
  const json = JSON.stringify(config, null, 2);
  writeFileSync(configPath, json, 'utf8');
  // The container runs as the host user (see hostUserArgs) so it owns this dir
  // and writes split secrets the host can read back. Widen perms anyway so a
  // Windows-local run (where --user is skipped) can still traverse and read it.
  chmodSync(dir, 0o755);
  chmodSync(configPath, 0o644);
  return { dir, configPath, credsPath };
}

/**
 * Reads and parses a split config or credentials JSON file from disk.
 * @param path - Absolute JSON file path.
 * @returns Parsed split-file shape used by these assertions.
 */
function readSplit(path: string): ISplitFile {
  const json = readFileSync(path, 'utf8');
  return JSON.parse(json) as ISplitFile;
}

/**
 * Locates a portal field by manifest data path.
 * @param page - Active portal page.
 * @param path - Manifest dotted field path.
 * @returns Locator for the matching form control.
 */
function byPath(page: Page, path: string): Locator {
  return page.locator(`[data-path="${path}"]`);
}

/**
 * Logs into the Dockerized portal and waits for the app shell.
 * @param page - Fresh browser page.
 * @param baseUrl - Dockerized portal base URL.
 * @returns Resolves after authenticated UI is visible.
 */
async function login(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl);
  await page.fill('#pw', PASSWORD);
  await page.click('#pw-btn');
  await page.waitForSelector('#app', { state: 'visible' });
}

/**
 * Opens a fresh browser context and authenticated portal page.
 * @param baseUrl - Dockerized portal base URL.
 * @returns Browser context and page ready for portal interactions.
 */
async function openPortal(baseUrl: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await login(page, baseUrl);
  return { context, page };
}

/**
 * Saves the current portal form and waits for the success status.
 * @param page - Authenticated portal page.
 * @returns Resolves after the UI reports a saved config.
 */
async function saveOk(page: Page): Promise<void> {
  await page.click('#save');
  await page.waitForSelector('#status:has-text("Saved")', { timeout: 15_000 });
}

/**
 * Stops a container if it was started.
 * @param container - Optional Dockerized portal container.
 * @returns Nothing.
 */
function stopContainer(container: IPortalContainer | undefined): void {
  if (!container) return;
  stopPortalContainer(container.id);
}

/**
 * Closes a browser context if it was opened.
 * @param context - Optional browser context.
 * @returns Resolves after context teardown completes.
 */
async function closeContext(context: BrowserContext | undefined): Promise<void> {
  await context?.close();
}

/**
 * Drives a portal edit through a read-write Docker directory mount.
 * @returns Resolves after host files prove the edit and secret split.
 */
async function persistsPortalEdit(): Promise<void> {
  const seeded = seedDir();
  let container: IPortalContainer | undefined;
  let context: BrowserContext | undefined;
  try {
    container = startPortalContainer({ dir: seeded.dir, mode: 'rw' });
    await waitForPortal(container);
    const opened = await openPortal(container.baseUrl);
    context = opened.context;
    await gotoBanks(opened.page);
    const daysBack = byPath(opened.page, 'banks.discount.daysBack');
    await setValue(daysBack, '28');
    await saveOk(opened.page);
    assertPersistedEdit(seeded);
  } finally {
    await closeContext(context);
    stopContainer(container);
    rmSync(seeded.dir, { recursive: true, force: true });
  }
}

/**
 * Asserts the read-write portal save reached the host directory correctly.
 * @param seeded - Host directory and file paths created for this test.
 * @returns Nothing.
 */
function assertPersistedEdit(seeded: ISeededDir): void {
  const config = readSplit(seeded.configPath);
  const credentials = readSplit(seeded.credsPath);
  expect(config.banks?.discount.daysBack).toBe(28);
  expect(config.banks?.discount.password).toBeUndefined();
  expect(credentials.banks?.discount.password).toBe(DISCOUNT_SECRET);
}

/**
 * Drives a portal edit through a read-only Docker directory mount.
 * @returns Resolves after the UI reports failure and host config remains intact.
 */
async function blocksReadOnlyWrites(): Promise<void> {
  const seeded = seedDir();
  const originalConfig = readFileSync(seeded.configPath, 'utf8');
  let container: IPortalContainer | undefined;
  let context: BrowserContext | undefined;
  try {
    container = startPortalContainer({ dir: seeded.dir, mode: 'ro' });
    await waitForPortal(container);
    const opened = await openPortal(container.baseUrl);
    context = opened.context;
    await attemptReadOnlySave(opened.page);
    const currentConfig = readFileSync(seeded.configPath, 'utf8');
    expect(currentConfig).toBe(originalConfig);
  } finally {
    await closeContext(context);
    stopContainer(container);
    rmSync(seeded.dir, { recursive: true, force: true });
  }
}

/**
 * Attempts a save expected to fail on a read-only Docker mount.
 * @param page - Authenticated portal page.
 * @returns Resolves after the status bar shows the write failure.
 */
async function attemptReadOnlySave(page: Page): Promise<void> {
  await gotoBanks(page);
  const daysBack = byPath(page, 'banks.discount.daysBack');
  // Use a value that passes offline validation (daysBack must be 1-30) so the
  // save reaches the disk write the read-only mount is meant to block; an
  // out-of-range value would fail validation (400) before any write attempt.
  await setValue(daysBack, '29');
  await page.click('#save');
  await page.waitForSelector('#status:has-text("Failed to persist configuration")', { timeout: 15_000 });
  const statusText = await page.locator('#status').textContent();
  expect(statusText).not.toMatch(/Saved/i);
}

/**
 * Registers the Docker portal E2E suite.
 * @returns Nothing.
 */
function portalDockerSuite(): void {
  beforeAll(launchBrowser, 120_000);
  afterAll(closeBrowser);
  it('persists a portal edit to the host directory volume', persistsPortalEdit, 120_000);
  it('a read-only mount blocks portal writes and leaves files unchanged', blocksReadOnlyWrites, 120_000);
}

describe.runIf(hasDockerImage())('Portal Docker E2E', portalDockerSuite);
