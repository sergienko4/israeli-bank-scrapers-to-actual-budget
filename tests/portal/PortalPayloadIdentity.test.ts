/**
 * Payload identity: proves that declaring response schemas did not change a
 * single byte any client receives.
 *
 * This is the one test that guards the real hazard of this work. Fastify
 * serialises replies through the response schema and silently DROPS any
 * property the schema does not declare — no error, no warning, the field is
 * simply gone. Both clients render the config from the manifest, so a dropped
 * property does not fail a type check anywhere; it just makes a field vanish
 * from the UI.
 *
 * The snapshots were recorded against the build BEFORE any schema existed. If
 * a schema is incomplete, the snapshot below stops matching. Never update these
 * snapshots to make a failure go away: a diff here means the schema is missing
 * a property that the server really sends.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { faker } from '@faker-js/faker';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import PortalConfigStore from '../../src/Portal/PortalConfigStore.js';
import { buildPortal } from '../../src/Portal/PortalServer.js';
import { fakePortalRuntime, PORTAL_TEST_PASSWORD, seedConfigDir } from '../helpers/portalFactories.js';

let app: FastifyInstance;
let dir: string;
let cookie: string;

const ENV_KEYS = ['AUDIT_LOG_PATH', 'OTP_REQUESTS_PATH', 'OTP_SETTINGS_PATH'] as const;
const originalEnv = new Map<string, string | undefined>();

/** One run covering a success, a failure, and the reconciliation fields. */
const AUDIT_FIXTURE = [
  {
    timestamp: '2026-01-02T03:04:05.000Z',
    totalBanks: 4,
    successfulBanks: 3,
    failedBanks: 1,
    totalTransactions: 21,
    totalDuplicates: 2,
    totalDuration: 12_345,
    successRate: 75,
    banks: [
      {
        name: 'hapoalim', status: 'success', duration: 4200, txns: 12,
        reconciliationStatus: 'matched', reconciliationAmount: 0,
      },
      { name: 'discount', status: 'success', duration: 3100, txns: 9 },
      { name: 'leumi', status: 'failed', duration: 900, txns: 0, error: 'Login failed' },
    ],
  },
];

/** One live, unanswered request, so the populated shape is exercised. */
const OTP_FIXTURE = [
  {
    id: 'req-1',
    bankId: 'hapoalim',
    createdAt: 1_700_000_000_000,
    deadline: Date.now() + 300_000,
  },
];

/**
 * Signs in with the seeded portal password.
 * @returns The portal_session cookie value.
 */
async function loginCookie(): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/auth/login', payload: { password: PORTAL_TEST_PASSWORD },
  });
  return res.cookies[0].value;
}

/**
 * Fetches a guarded endpoint and parses its JSON body.
 * @param url - Path to request.
 * @returns The parsed response body.
 */
async function getJson(url: string): Promise<unknown> {
  const res = await app.inject({ method: 'GET', url, cookies: { portal_session: cookie } });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body) as unknown;
}

describe('portal payload identity', () => {
  beforeEach(async () => {
    faker.seed(20260801);
    for (const key of ENV_KEYS) originalEnv.set(key, process.env[key]);
    dir = mkdtempSync(join(tmpdir(), 'portal-payload-'));
    process.env.AUDIT_LOG_PATH = join(dir, 'audit-log.json');
    process.env.OTP_REQUESTS_PATH = join(dir, 'otp-requests.json');
    process.env.OTP_SETTINGS_PATH = join(dir, 'otp-settings.json');
    writeFileSync(process.env.AUDIT_LOG_PATH, JSON.stringify(AUDIT_FIXTURE));
    writeFileSync(process.env.OTP_REQUESTS_PATH, JSON.stringify(OTP_FIXTURE));
    const seed = seedConfigDir();
    app = await buildPortal(fakePortalRuntime(), new PortalConfigStore(seed.path));
    rmSync(seed.dir, { recursive: true, force: true });
    cookie = await loginCookie();
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('serves the manifest unchanged, to full nesting depth', async () => {
    expect(await getJson('/api/manifest')).toMatchSnapshot();
  });

  it('serves the masked config unchanged', async () => {
    expect(await getJson('/api/config')).toMatchSnapshot();
  });

  it('serves run history unchanged, including reconciliation fields', async () => {
    expect(await getJson('/api/status')).toEqual({ runs: AUDIT_FIXTURE });
  });

  it('serves pending OTP requests unchanged, and never the code', async () => {
    const [pending] = OTP_FIXTURE;
    expect(await getJson('/api/otp/pending')).toEqual({
      requests: [{
        id: pending.id,
        bankId: pending.bankId,
        createdAt: pending.createdAt,
        deadline: pending.deadline,
      }],
    });
  });

  it('serves OTP settings unchanged', async () => {
    expect(await getJson('/api/otp/settings')).toEqual({ channel: 'telegram' });
  });
});
