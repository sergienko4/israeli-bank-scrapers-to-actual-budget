/**
 * The portal sweeps the staging leftovers of the four runtime stores it
 * writes, and of the config it saves, when it starts, so a portal killed
 * mid-write does not keep a staged file for ever when no import runs. The
 * audit log is the importer's to sweep: the portal only reads it.
 */

import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startPortal } from '../../src/Portal/PortalServer.js';
import { fakePortalRuntime, seedConfigDir } from '../helpers/portalFactories.js';

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

/** A valid staging token, so the names match the stores' staging scheme. */
const STAGED_UUID = '0f0e0d0c-0b0a-4908-8706-050403020100';

/** Seconds since the epoch two hours ago, past the one-hour grace period. */
const TWO_HOURS_AGO = (Date.now() - 2 * 60 * 60 * 1000) / 1000;

const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
let dir: string;

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

describe('portal start', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'portal-sweep-'));
    for (const key of KEYS) process.env[key] = join(dir, STORE_PATHS[key]);
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('sweeps the leftovers of the four stores the portal writes, not the audit log', async () => {
    const portalWritten = [
      leaveStaged('OTP_SETTINGS_PATH'), leaveStaged('DEVICE_TOKENS_PATH'), leaveStaged('OTP_REQUESTS_PATH'),
      leaveStaged('APP_TOKENS_PATH'),
    ];
    const auditLeftover = leaveStaged('AUDIT_LOG_PATH');
    const seed = seedConfigDir();
    const server = await startPortal(fakePortalRuntime({ port: 0 }), seed.path);
    await server.close();
    rmSync(seed.dir, { recursive: true, force: true });
    expect(portalWritten.filter((path) => existsSync(path))).toEqual([]);
    expect(existsSync(auditLeftover)).toBe(true);
  });

  it('removes an OTP answer an hour past its deadline, code and all', async () => {
    const answer = join(dir, `otp-requests.${STAGED_UUID}.answer.json`);
    const expired = { requestId: STAGED_UUID, deadline: TWO_HOURS_AGO * 1000, code: '123456' };
    writeFileSync(answer, JSON.stringify(expired), { mode: 0o600 });
    const seed = seedConfigDir();
    const server = await startPortal(fakePortalRuntime({ port: 0 }), seed.path);
    await server.close();
    rmSync(seed.dir, { recursive: true, force: true });
    expect(existsSync(answer)).toBe(false);
  });

  it('sweeps the config writer\'s leftovers, including the old fixed-name `.tmp` files', async () => {
    const seed = seedConfigDir();
    const leftovers = [
      `${seed.path}.tmp`, join(seed.dir, 'credentials.json.tmp'), `${seed.path}.${STAGED_UUID}.tmp`,
    ];
    for (const leftover of leftovers) {
      writeFileSync(leftover, '{}', { mode: 0o600 });
      utimesSync(leftover, TWO_HOURS_AGO, TWO_HOURS_AGO);
    }
    const server = await startPortal(fakePortalRuntime({ port: 0 }), seed.path);
    await server.close();
    const remaining = leftovers.filter((path) => existsSync(path));
    rmSync(seed.dir, { recursive: true, force: true });
    expect(remaining).toEqual([]);
  });
});
