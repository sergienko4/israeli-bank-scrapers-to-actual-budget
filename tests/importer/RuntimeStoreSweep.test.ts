/**
 * An import sweeps the staging leftovers of the runtime stores it writes when
 * it starts, on the real filesystem at the configured paths. It leaves the
 * stores only the portal writes alone, because a leftover there may belong
 * to a portal that is still running.
 */

import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import sweepImportStores from '../../src/Importer/RuntimeStoreSweep.js';
import type { ILogger } from '../../src/Logger/ILogger.js';

/** The path each runtime store reads from the environment. */
const STORE_PATHS = {
  AUDIT_LOG_PATH: 'audit-log.json',
  OTP_SETTINGS_PATH: 'otp-settings.json',
  DEVICE_TOKENS_PATH: 'device-tokens.json',
  OTP_REQUESTS_PATH: 'otp-requests.json',
  APP_TOKENS_PATH: 'app-tokens.json',
} as const;

type StorePathKey = keyof typeof STORE_PATHS;

/** Every key the cases set, so each can be restored. */
const KEYS = Object.keys(STORE_PATHS) as StorePathKey[];

/** The stores an import writes: runs it records, and codes it asks for. */
const IMPORT_WRITES: readonly StorePathKey[] = ['AUDIT_LOG_PATH', 'OTP_REQUESTS_PATH'];

/** A valid staging token, so the names match the stores' staging scheme. */
const STAGED_UUID = '0f0e0d0c-0b0a-4908-8706-050403020100';

/** Seconds since the epoch two hours ago, past the one-hour grace period. */
const TWO_HOURS_AGO = (Date.now() - 2 * 60 * 60 * 1000) / 1000;

const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
let dir: string;

/**
 * Builds a logger whose calls the cases inspect.
 * @returns A logger with spy methods.
 */
function spyLogger(): ILogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger;
}

/**
 * Leaves an abandoned staged file beside one store.
 * @param key - The store's path variable.
 * @returns The staged file's path.
 */
function leaveStaged(key: StorePathKey): string {
  const staged = `${join(dir, STORE_PATHS[key])}.${STAGED_UUID}.tmp`;
  writeFileSync(staged, '{}', { mode: 0o600 });
  utimesSync(staged, TWO_HOURS_AGO, TWO_HOURS_AGO);
  return staged;
}

describe('sweepImportStores', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'import-sweep-'));
    for (const key of KEYS) process.env[key] = join(dir, STORE_PATHS[key]);
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('sweeps the leftovers of the stores an import writes', () => {
    const staged = IMPORT_WRITES.map((key) => leaveStaged(key));
    const logger = spyLogger();
    expect(sweepImportStores(logger)).toBe(IMPORT_WRITES.length);
    expect(staged.filter((path) => existsSync(path))).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('leaves the leftovers of the stores only the portal writes', () => {
    const portalOnly = KEYS.filter((key) => !IMPORT_WRITES.includes(key));
    expect(portalOnly).toEqual(['OTP_SETTINGS_PATH', 'DEVICE_TOKENS_PATH', 'APP_TOKENS_PATH']);
    const staged = portalOnly.map((key) => leaveStaged(key));
    sweepImportStores(spyLogger());
    expect(staged.filter((path) => existsSync(path))).toEqual(staged);
  });
});
