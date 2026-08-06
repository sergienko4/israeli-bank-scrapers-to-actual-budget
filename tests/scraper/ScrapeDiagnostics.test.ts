/**
 * Scrape diagnostics wiring tests.
 *
 * A visaCal run failed with a single opaque line ("resolved zero accounts")
 * because the provider was never asked to explain itself. These guard that
 * raising the importer log level turns on the provider's own login trace and
 * failure screenshot, and that a normal run stays quiet.
 */
import { join } from 'node:path';

import type { ScraperOptions } from '@sergienko4/israeli-bank-scrapers';
import { describe, expect, it } from 'vitest';

import attachDiagnostics, {
  wantsDiagnostics,
} from '../../src/Scraper/Strategies/Live/ScrapeDiagnostics.js';
import type { IBankConfig } from '../../src/Types/Index.js';

/** Screenshot directory the importer defaults to, anchored on the workdir. */
const DEFAULT_SHOT_DIR = join(process.cwd(), 'logs', 'failures');

/** Matches the timestamped PNG file name the diagnostics wiring generates. */
const SHOT_FILE = /visaCal-\d{4}-\d{2}-\d{2}T[\d-]+Z\.png$/u;

/**
 * Builds an empty provider options object for assertions.
 * @returns Provider options with only the required identity fields.
 */
function buildOptions(): ScraperOptions {
  return { companyId: 'visaCal', startDate: new Date() } as unknown as ScraperOptions;
}

describe('wantsDiagnostics', () => {
  it.each(['debug', 'trace', 'DEBUG', 'Trace'])('enables diagnostics at %s', (level) => {
    expect(wantsDiagnostics(level)).toBe(true);
  });

  it.each(['info', 'warn', 'error', ''])('leaves diagnostics off at %s', (level) => {
    expect(wantsDiagnostics(level)).toBe(false);
  });
});

describe('attachDiagnostics', () => {
  it('asks the provider to explain itself when running at debug', () => {
    const options = buildOptions();
    expect(attachDiagnostics(options, {}, 'debug')).toBe(true);
    expect(options.verbose).toBe(true);
    expect(options.loginLogLevel).toBe('trace');
    expect(options.storeFailureScreenShotPath).toContain(DEFAULT_SHOT_DIR);
  });

  it('names the screenshot file so the provider cannot overwrite a folder', () => {
    const options = buildOptions();
    attachDiagnostics(options, {}, 'debug');
    expect(options.storeFailureScreenShotPath).toMatch(SHOT_FILE);
  });

  it('keeps each failure by stamping the screenshot file name', () => {
    const first = buildOptions();
    const second = buildOptions();
    attachDiagnostics(first, { failureScreenshotPath: '/data/shots' }, 'debug');
    attachDiagnostics(second, { failureScreenshotPath: '/data/shots' }, 'debug');
    expect(first.storeFailureScreenShotPath).toMatch(SHOT_FILE);
    expect(second.storeFailureScreenShotPath).toMatch(SHOT_FILE);
  });

  it('keeps a normal run quiet so logs stay readable', () => {
    const options = buildOptions();
    expect(attachDiagnostics(options, {}, 'info')).toBe(false);
    expect(options.verbose).toBeUndefined();
    expect(options.loginLogLevel).toBeUndefined();
    expect(options.storeFailureScreenShotPath).toBeUndefined();
  });

  it('honours a per-bank screenshot directory override', () => {
    const options = buildOptions();
    const bankConfig: IBankConfig = { failureScreenshotPath: '/app/data/shots' };
    attachDiagnostics(options, bankConfig, 'trace');
    expect(options.storeFailureScreenShotPath).toContain('shots');
  });

  it('ignores an empty screenshot override and uses the default', () => {
    const options = buildOptions();
    attachDiagnostics(options, { failureScreenshotPath: '' }, 'debug');
    expect(options.storeFailureScreenShotPath).toContain(DEFAULT_SHOT_DIR);
  });
});
