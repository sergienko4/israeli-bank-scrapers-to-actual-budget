/**
 * ScraperOptionsBuilder — browser args and session directory helpers.
 *
 * NOTE (v7.9.0): The scraper now uses Camoufox (Firefox-based) instead of Chromium.
 * Chrome args are accepted by the ScraperOptions type but ignored by Camoufox.
 * These functions are kept for backward compatibility and future proxy support
 * (Camoufox natively supports proxy via its LaunchOptions.proxy field).
 */

import type { IProxyConfig } from '../Types/Index.js';

const BASE_CHROME_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

/**
 * Returns the Chrome user-data directory path for a given bank.
 * NOTE: Camoufox does not use Chrome data dirs; this is a no-op with v7.9.0+.
 * @param bankName - Optional bank name appended as a subdirectory for isolation.
 * @returns Absolute path to the Chrome data directory.
 */
export function getChromeDataDir(bankName?: string): string {
  const baseDir = process.env.CHROME_DATA_DIR || '/app/chrome-data';
  return bankName ? `${baseDir}/${bankName}` : baseDir;
}

/**
 * Builds the Chrome launch argument array, optionally adding a proxy server.
 * NOTE: Camoufox ignores Chrome args; proxy is not yet forwarded in v7.9.0.
 * @param proxy - Optional IProxyConfig whose server URL is passed to --proxy-server.
 * @returns Array of Chrome CLI argument strings.
 */
export function buildChromeArgs(proxy?: IProxyConfig): string[] {
  const args = [...BASE_CHROME_ARGS];
  if (proxy?.server) args.push(`--proxy-server=${proxy.server}`);
  return args;
}
