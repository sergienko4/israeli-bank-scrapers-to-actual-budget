/**
 * ScraperOptionsBuilder — builds Chrome args and stealth overrides
 * Extracted for testability and SRP (keeps index.ts clean)
 */

import type { Page } from 'puppeteer';
import type { ProxyConfig } from '../types/index.js';

const BASE_CHROME_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
const STEALTH_CHROME_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--window-size=1920,1080',
];

export function buildChromeArgs(proxy?: ProxyConfig, stealth?: boolean): string[] {
  const chromeDataDir = process.env.CHROME_DATA_DIR || '/app/chrome-data';
  const args = [...BASE_CHROME_ARGS, `--user-data-dir=${chromeDataDir}`];
  if (stealth) args.push(...STEALTH_CHROME_ARGS);
  if (proxy?.server) args.push(`--proxy-server=${proxy.server}`);
  return args;
}

export function getStealthScript(): string {
  return [
    // Hide webdriver flag (most common WAF detection)
    "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });",
    // Set realistic browser languages (Hebrew + English)
    "Object.defineProperty(navigator, 'languages', { get: () => ['he-IL', 'he', 'en-US', 'en'] });",
    // Fake plugins (headless Chrome reports 0)
    "Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });",
    // Inject chrome.runtime (missing in headless)
    "window.chrome = { runtime: {} };",
    // Hide headless in user-agent hint
    "Object.defineProperty(navigator, 'userAgentData', { get: () => ({ brands: [{brand:'Google Chrome',version:'131'},{brand:'Chromium',version:'131'}], mobile: false, platform: 'Linux' }) });",
    // Override permissions query to hide automation
    "const originalQuery = window.navigator.permissions.query;",
    "window.navigator.permissions.query = (parameters) => (parameters.name === 'notifications' ? Promise.resolve({ state: Notification.permission }) : originalQuery(parameters));",
  ].join('\n');
}

export async function applyStealthOverrides(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(getStealthScript());
}
