/**
 * ScraperOptionsBuilder — builds Chrome args for the bank scraper
 * Anti-detection is now handled internally by the scraper (v6.8.0+)
 */

import type { ProxyConfig } from '../types/index.js';

const BASE_CHROME_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

export function getChromeDataDir(bankName?: string): string {
  const baseDir = process.env.CHROME_DATA_DIR || '/app/chrome-data';
  return bankName ? `${baseDir}/${bankName}` : baseDir;
}

export function buildChromeArgs(proxy?: ProxyConfig, bankName?: string): string[] {
  const args = [...BASE_CHROME_ARGS, `--user-data-dir=${getChromeDataDir(bankName)}`];
  if (proxy?.server) args.push(`--proxy-server=${proxy.server}`);
  return args;
}
