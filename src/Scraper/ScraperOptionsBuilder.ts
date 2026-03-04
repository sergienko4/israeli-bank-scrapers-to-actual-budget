/**
 * ScraperOptionsBuilder — builds Chrome args for the bank scraper
 * Anti-detection is now handled internally by the scraper (v7.0.0+, Playwright)
 */

import type { ProxyConfig } from '../Types/Index.js';

const BASE_CHROME_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

export function getChromeDataDir(bankName?: string): string {
  const baseDir = process.env.CHROME_DATA_DIR || '/app/chrome-data';
  return bankName ? `${baseDir}/${bankName}` : baseDir;
}

export function buildChromeArgs(proxy?: ProxyConfig): string[] {
  const args = [...BASE_CHROME_ARGS];
  if (proxy?.server) args.push(`--proxy-server=${proxy.server}`);
  return args;
}
