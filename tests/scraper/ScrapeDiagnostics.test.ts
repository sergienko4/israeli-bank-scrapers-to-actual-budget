/**
 * Scrape diagnostics wiring tests.
 *
 * A visaCal run failed with a single opaque line ("resolved zero accounts")
 * because the provider was never asked to explain itself. These guard that
 * raising the importer log level turns on the provider's own login trace and
 * failure screenshot, and that a normal run stays quiet.
 */
import type { ScraperOptions } from '@sergienko4/israeli-bank-scrapers';
import { describe, expect, it } from 'vitest';

import attachDiagnostics, {
  wantsDiagnostics,
} from '../../src/Scraper/Strategies/Live/ScrapeDiagnostics.js';
import type { IBankConfig } from '../../src/Types/Index.js';

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
    expect(options.storeFailureScreenShotPath).toBe('/app/logs/failures');
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
    expect(options.storeFailureScreenShotPath).toBe('/app/data/shots');
  });

  it('ignores an empty screenshot override and uses the default', () => {
    const options = buildOptions();
    attachDiagnostics(options, { failureScreenshotPath: '' }, 'debug');
    expect(options.storeFailureScreenShotPath).toBe('/app/logs/failures');
  });
});
