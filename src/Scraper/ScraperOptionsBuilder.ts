/**
 * ScraperOptionsBuilder — builds Chrome args for the bank scraper
 * Anti-detection is now handled internally by the scraper (v7.0.0+, Playwright)
 */

import type { ProxyConfig } from '../Types/Index.js';

const BASE_CHROME_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

/**
 * Returns the Chrome user-data directory path for a given bank.
 * @param bankName - Optional bank name appended as a subdirectory for isolation.
 * @returns Absolute path to the Chrome data directory.
 */
export function getChromeDataDir(bankName?: string): string {
  const baseDir = process.env.CHROME_DATA_DIR || '/app/chrome-data';
  return bankName ? `${baseDir}/${bankName}` : baseDir;
}

/**
 * Builds the Chrome launch argument array, optionally adding a proxy server.
 * @param proxy - Optional ProxyConfig whose server URL is passed to --proxy-server.
 * @returns Array of Chrome CLI argument strings.
 */
export function buildChromeArgs(proxy?: ProxyConfig): string[] {
  const args = [...BASE_CHROME_ARGS];
  if (proxy?.server) args.push(`--proxy-server=${proxy.server}`);
  return args;
}
