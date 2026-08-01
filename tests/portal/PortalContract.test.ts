/**
 * Contract conformance: proves the live server satisfies the declared contract.
 *
 * Response schemas cover most endpoints, but two gaps need this test. The
 * manifest carries no response schema (its recursive shape cannot be inlined
 * safely — see PortalApiRoutes), and a response schema only proves the payload
 * can be serialised through it, not that the handler's data was ever the right
 * shape to begin with.
 *
 * So this checks the real payloads against the real schemas. When a server type
 * drifts away from the contract the clients compile against, this is what fails.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { faker } from '@faker-js/faker';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONFIG_BODY } from '../../src/Contract/Config.js';
import { MANIFEST_BODY } from '../../src/Contract/Manifest.js';
import { OTP_SETTINGS, PENDING_OTP_BODY } from '../../src/Contract/Otp.js';
import { STATUS_BODY } from '../../src/Contract/Status.js';
import PortalConfigStore from '../../src/Portal/PortalConfigStore.js';
import { buildPortal } from '../../src/Portal/PortalServer.js';
import { fakePortalRuntime, PORTAL_TEST_PASSWORD, seedConfigDir } from '../helpers/portalFactories.js';

let app: FastifyInstance;
let dir: string;
let cookie: string;

const ENV_KEYS = ['AUDIT_LOG_PATH', 'OTP_REQUESTS_PATH', 'OTP_SETTINGS_PATH'] as const;
const originalEnv = new Map<string, string | undefined>();

/** A run whose success rate is a percentage, as the contract requires. */
const AUDIT_FIXTURE = [{
  timestamp: '2026-01-02T03:04:05.000Z',
  totalBanks: 4, successfulBanks: 3, failedBanks: 1,
  totalTransactions: 21, totalDuplicates: 2, totalDuration: 12_345, successRate: 75,
  banks: [{ name: 'hapoalim', status: 'success', duration: 4200, txns: 12 }],
}];

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
 * Asserts a live endpoint's payload satisfies its contract schema.
 * @param url - Endpoint to fetch.
 * @param schema - Contract schema the payload must satisfy.
 * @returns Nothing; failures are reported through expect.
 */
async function expectConforms(url: string, schema: TSchema): Promise<void> {
  const res = await app.inject({ method: 'GET', url, cookies: { portal_session: cookie } });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body) as unknown;
  const errors = [...Value.Errors(schema, body)].map(e => `${e.path}: ${e.message}`);
  expect(errors).toEqual([]);
}

describe('portal contract conformance', () => {
  beforeEach(async () => {
    faker.seed(20260801);
    for (const key of ENV_KEYS) originalEnv.set(key, process.env[key]);
    dir = mkdtempSync(join(tmpdir(), 'portal-contract-'));
    process.env.AUDIT_LOG_PATH = join(dir, 'audit-log.json');
    process.env.OTP_REQUESTS_PATH = join(dir, 'otp-requests.json');
    process.env.OTP_SETTINGS_PATH = join(dir, 'otp-settings.json');
    writeFileSync(process.env.AUDIT_LOG_PATH, JSON.stringify(AUDIT_FIXTURE));
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

  it('serves a manifest matching the contract, to full nesting depth', async () => {
    await expectConforms('/api/manifest', MANIFEST_BODY);
  });

  it('serves a config matching the contract', async () => {
    await expectConforms('/api/config', CONFIG_BODY);
  });

  it('serves run history matching the contract', async () => {
    await expectConforms('/api/status', STATUS_BODY);
  });

  it('serves pending OTP requests matching the contract', async () => {
    await expectConforms('/api/otp/pending', PENDING_OTP_BODY);
  });

  it('serves OTP settings matching the contract', async () => {
    await expectConforms('/api/otp/settings', OTP_SETTINGS);
  });

  it('refuses a success rate expressed as a fraction, the bug this contract exists for', () => {
    const fraction = { runs: [{ ...AUDIT_FIXTURE[0], successRate: 1 }] };
    expect(Value.Check(STATUS_BODY, fraction)).toBe(true);
    const outOfRange = { runs: [{ ...AUDIT_FIXTURE[0], successRate: 10_000 }] };
    expect(Value.Check(STATUS_BODY, outOfRange)).toBe(false);
  });
});
