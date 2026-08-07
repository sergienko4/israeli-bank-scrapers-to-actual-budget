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

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { ScraperOptions } from '@sergienko4/israeli-bank-scrapers';

import type { IBankConfig } from '../../../Types/Index.js';

/** Importer log levels that turn on provider diagnostics. */
const DIAGNOSTIC_LEVELS = new Set<string>(['debug', 'trace']);

/** Path segments, below the working directory, holding failure screenshots. */
const FAILURE_SHOT_SEGMENTS = ['logs', 'failures'];

/** Characters of randomness appended to a screenshot name to avoid collisions. */
const SHOT_NONCE_LENGTH = 8;

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
 * Resolves the default screenshot directory below the working directory.
 *
 * Anchoring on the working directory keeps one path expression correct both
 * inside the container, where it resolves to /app/logs/failures, and on a
 * developer machine running the real-bank suites directly.
 * @returns Absolute default directory for provider failure screenshots.
 */
function defaultShotDir(): string {
  const cwd = process.cwd();
  return join(cwd, ...FAILURE_SHOT_SEGMENTS);
}

/**
 * Builds a collision-free screenshot file name for one failed scrape.
 *
 * The timestamp alone is not enough: two attempts on the same bank can land in
 * the same millisecond, and the loser would silently overwrite the evidence of
 * the winner. A short random suffix keeps every failure on disk.
 * @param companyId - Provider company id being scraped.
 * @returns File name carrying the bank, the failure timestamp and a nonce.
 */
function shotFileName(companyId: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const nonce = randomUUID().slice(0, SHOT_NONCE_LENGTH);
  return `${companyId}-${stamp}-${nonce}.png`;
}

/**
 * Resolves the file the provider writes its failure screenshot to.
 *
 * The provider treats this option as a file path, not a directory, so a bare
 * directory would be overwritten by a PNG. Naming the file per run also keeps
 * one failure from erasing the evidence of the previous one.
 * @param target - Provider options, consulted for the company id.
 * @param bankConfig - Bank config that may override the screenshot directory.
 * @returns Absolute file path for this run's failure screenshot.
 */
function resolveShotPath(target: ScraperOptions, bankConfig: IBankConfig): string {
  const configured = bankConfig.failureScreenshotPath ?? '';
  const dir = configured === '' ? defaultShotDir() : configured;
  const file = shotFileName(target.companyId);
  return join(dir, file);
}

/**
 * Attaches provider diagnostics when the importer is running verbosely.
 *
 * `loginLogLevel` makes the provider narrate each step, and
 * `storeFailureScreenShotPath` makes it photograph the page before it tears
 * the browser down on any failed session — together they turn an opaque
 * "zero accounts" result into a diagnosable one.
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
  target.storeFailureScreenShotPath = resolveShotPath(target, bankConfig);
  return true;
}
