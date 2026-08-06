/**
 * Provider diagnostics wiring for live scrapes.
 *
 * The provider can report why a login failed — verbose step logging and a
 * screenshot taken at the point of failure — but only when it is asked to.
 * Without these, a failed scrape surfaces as a single opaque line such as
 * "resolved zero accounts", which says the session was invalid but not why.
 *
 * Diagnostics follow the importer's own log level rather than a separate
 * switch, so raising the log level to debug is enough to get a diagnosable
 * failure on the next run — no config edit, no redeploy.
 * @internal
 */

import type { ScraperOptions } from '@sergienko4/israeli-bank-scrapers';

import type { IBankConfig } from '../../../Types/Index.js';

/** Importer log levels that turn on provider diagnostics. */
const DIAGNOSTIC_LEVELS = new Set<string>(['debug', 'trace']);

/** Directory the provider writes failure screenshots into. */
const FAILURE_SHOT_DIR = '/app/logs/failures';

/**
 * Reports whether the importer is running verbosely enough for diagnostics.
 * @param logLevel - Importer log level resolved from config or env.
 * @returns True when provider diagnostics should be requested.
 */
export function wantsDiagnostics(logLevel: string): boolean {
  const normalised = logLevel.toLowerCase();
  return DIAGNOSTIC_LEVELS.has(normalised);
}

/**
 * Resolves where provider failure screenshots are written.
 * @param bankConfig - Bank config that may override the screenshot directory.
 * @returns Absolute directory path for provider failure screenshots.
 */
function resolveShotDir(bankConfig: IBankConfig): string {
  const configured = bankConfig.failureScreenshotPath ?? '';
  if (configured !== '') return configured;
  return FAILURE_SHOT_DIR;
}

/**
 * Attaches provider diagnostics when the importer is running verbosely.
 *
 * `loginLogLevel` makes the provider narrate each login step, and
 * `storeFailureScreenShotPath` captures the page at the moment of failure —
 * together they turn an opaque "zero accounts" result into a diagnosable one.
 * @param target - Provider options object that receives the diagnostics.
 * @param bankConfig - Bank config consulted for the screenshot directory.
 * @param logLevel - Importer log level resolved from config or env.
 * @returns True when diagnostics were attached.
 */
export default function attachDiagnostics(
  target: ScraperOptions, bankConfig: IBankConfig, logLevel: string,
): boolean {
  if (!wantsDiagnostics(logLevel)) return false;
  target.verbose = true;
  target.loginLogLevel = 'trace';
  target.storeFailureScreenShotPath = resolveShotDir(bankConfig);
  return true;
}
