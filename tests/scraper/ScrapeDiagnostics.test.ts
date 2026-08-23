/**
 * Scrape diagnostics wiring tests.
 *
 * A visaCal run failed with a single opaque line ("resolved zero accounts")
 * because the provider was never asked to explain itself. These guard that
 * raising the importer log level turns on the provider's failure screenshot,
 * that a normal run stays quiet, and that the two provider options the library
 * declares but never reads are left alone.
 */
import { join } from 'node:path';

import type { ScraperOptions } from '@sergienko4/israeli-bank-scrapers';
import { describe, expect, it, vi } from 'vitest';

import attachDiagnostics, {
  wantsDiagnostics,
} from '../../src/Scraper/Strategies/Live/ScrapeDiagnostics.js';
import type { IBankConfig } from '../../src/Types/Index.js';

/** Screenshot directory the importer defaults to, anchored on the workdir. */
const DEFAULT_SHOT_DIR = join(process.cwd(), 'logs', 'failures');

/** Matches the timestamped, nonce-suffixed PNG name the wiring generates. */
const SHOT_FILE = /visaCal-\d{4}-\d{2}-\d{2}T[\d-]+Z-[0-9a-f]{8}\.png$/u;

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
    expect(options.storeFailureScreenShotPath).toContain(DEFAULT_SHOT_DIR);
  });

  it('leaves the options the provider declares but never reads unset', () => {
    const options = buildOptions();
    attachDiagnostics(options, {}, 'debug');
    expect(options.verbose).toBeUndefined();
    expect(options.loginLogLevel).toBeUndefined();
  });

  it('names the screenshot file so the provider cannot overwrite a folder', () => {
    const options = buildOptions();
    attachDiagnostics(options, {}, 'debug');
    expect(options.storeFailureScreenShotPath).toMatch(SHOT_FILE);
  });

  it('keeps each failure even when two attempts share a millisecond', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T09:15:00.000Z'));
    try {
      const first = buildOptions();
      const second = buildOptions();
      attachDiagnostics(first, { failureScreenshotPath: '/data/shots' }, 'debug');
      attachDiagnostics(second, { failureScreenshotPath: '/data/shots' }, 'debug');
      expect(first.storeFailureScreenShotPath).toMatch(SHOT_FILE);
      expect(second.storeFailureScreenShotPath).toMatch(SHOT_FILE);
      expect(first.storeFailureScreenShotPath)
        .not.toBe(second.storeFailureScreenShotPath);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a normal run quiet so logs stay readable', () => {
    const options = buildOptions();
    expect(attachDiagnostics(options, {}, 'info')).toBe(false);
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
