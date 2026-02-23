/**
 * ScraperOptionsBuilder — builds Chrome args and stealth overrides
 * Extracted for testability and SRP (keeps index.ts clean)
 */

import type { Page } from 'puppeteer';
import type { ProxyConfig } from '../types/index.js';

const BASE_CHROME_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
const STEALTH_CHROME_ARGS = ['--disable-blink-features=AutomationControlled'];

export function buildChromeArgs(proxy?: ProxyConfig, stealth?: boolean): string[] {
  const chromeDataDir = process.env.CHROME_DATA_DIR || '/app/chrome-data';
  const args = [...BASE_CHROME_ARGS, `--user-data-dir=${chromeDataDir}`];
  if (stealth) args.push(...STEALTH_CHROME_ARGS);
  if (proxy?.server) args.push(`--proxy-server=${proxy.server}`);
  return args;
}

export function getStealthScript(): string {
  return [
    "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });",
    "Object.defineProperty(navigator, 'languages', { get: () => ['he-IL', 'he', 'en-US', 'en'] });",
    "Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });",
    "window.chrome = { runtime: {} };",
  ].join('\n');
}

export async function applyStealthOverrides(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(getStealthScript());
}
