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
import { DEVICE_BODY } from '../../src/Contract/Devices.js';
import { MANIFEST_BODY } from '../../src/Contract/Manifest.js';
import { OTP_SETTINGS, OTP_SUBMIT_BODY, PENDING_OTP_BODY } from '../../src/Contract/Otp.js';
import { STATUS_BODY } from '../../src/Contract/Status.js';
import PortalConfigStore from '../../src/Portal/PortalConfigStore.js';
import { buildPortal } from '../../src/Portal/PortalServer.js';
import { fakePortalRuntime, PORTAL_TEST_PASSWORD, seedConfigDir } from '../helpers/portalFactories.js';

let app: FastifyInstance;
let dir: string;
let cookie: string;
let seed: { dir: string; path: string };

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
 * @returns The parsed payload, so a caller can assert it was not vacuous.
 */
async function expectConforms(url: string, schema: TSchema): Promise<Record<string, unknown>> {
  const res = await app.inject({ method: 'GET', url, cookies: { portal_session: cookie } });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body) as Record<string, unknown>;
  const errors = [...Value.Errors(schema, body)].map(e => `${e.path}: ${e.message}`);
  expect(errors).toEqual([]);
  return body;
}

/** The reply shape `app.inject` resolves to, taken from Fastify itself. */
type InjectedReply = Awaited<ReturnType<FastifyInstance['inject']>>;

/**
 * Posts a JSON body to a guarded route.
 * @param url - Path to request.
 * @param payload - Body to send.
 * @returns The reply, for the caller to assert on.
 */
async function postJson(url: string, payload: unknown): Promise<InjectedReply> {
  return await app.inject({
    method: 'POST',
    url,
    cookies: { portal_session: cookie },
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(payload),
  });
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
    seed = seedConfigDir();
    app = await buildPortal(fakePortalRuntime(), new PortalConfigStore(seed.path));
    cookie = await loginCookie();
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(seed.dir, { recursive: true, force: true });
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
    const config = await expectConforms('/api/config', CONFIG_BODY);
    // CONFIG_BODY is an open record, so an empty object satisfies it. Without
    // this the test would pass just as happily against a config that never
    // loaded.
    expect(Object.keys(config)).toContain('actual');
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

  it('rejects a success rate outside 0-100', () => {
    // The range cannot catch a fraction: 1 is a legitimate one percent. What it
    // rejects is a value that could only come from a unit mistake downstream.
    const withinRange = { runs: [{ ...AUDIT_FIXTURE[0], successRate: 1 }] };
    expect(Value.Check(STATUS_BODY, withinRange)).toBe(true);
    const tooHigh = { runs: [{ ...AUDIT_FIXTURE[0], successRate: 10_000 }] };
    expect(Value.Check(STATUS_BODY, tooHigh)).toBe(false);
    const negative = { runs: [{ ...AUDIT_FIXTURE[0], successRate: -1 }] };
    expect(Value.Check(STATUS_BODY, negative)).toBe(false);
  });

  it('keeps line breaks out of a code and a push token', () => {
    // `$` in a JavaScript pattern is already end-of-input, so a trailing
    // newline is refused; the character classes are what stop one appearing in
    // the middle.
    expect(Value.Check(OTP_SUBMIT_BODY, { code: '123456' })).toBe(true);
    expect(Value.Check(OTP_SUBMIT_BODY, { code: '123456\n' })).toBe(false);
    expect(Value.Check(DEVICE_BODY, { token: 'ExponentPushToken[abc]' })).toBe(true);
    expect(Value.Check(DEVICE_BODY, { token: 'ExponentPushToken[abc]\n' })).toBe(false);
    expect(Value.Check(DEVICE_BODY, { token: 'ExponentPushToken[a\nb]' })).toBe(false);
  });

  it('refuses those requests at the route, in the wording each route owns', async () => {
    // The schema check above proves the pattern. It says nothing about whether
    // the route is wired to it, or whether the refusal reaches the client as
    // the portal's own `{ error }` body rather than Fastify's "Bad Request".
    const code = await postJson('/api/otp/req-1', { code: '123456\n' });
    expect(code.statusCode).toBe(400);
    expect(JSON.parse(code.body)).toEqual({ error: 'Invalid OTP code' });

    const device = await postJson('/api/devices', { token: 'ExponentPushToken[a\nb]' });
    expect(device.statusCode).toBe(400);
    expect(JSON.parse(device.body)).toEqual({ error: 'Invalid Expo push token' });
  });

  it('rejects a malformed field nested inside a manifest group', () => {
    // Proves the recursive $ref is actually followed. Without this, the
    // manifest conformance test above could pass because nothing below the
    // first level was ever checked.
    const nested = {
      sections: [{
        key: 'general', label: 'General', kind: 'object',
        fields: [{
          key: 'group', label: 'Group', kind: 'group',
          fields: [{ key: 'inner', label: 'Inner', kind: 'not-a-kind' }],
        }],
      }],
      banks: [],
      bankRequirements: {},
    };
    expect(Value.Check(MANIFEST_BODY, nested)).toBe(false);
  });

  it('answers a refused config write with a body the app can read', async () => {
    // The 400 for a schema-validation failure carries only `error`, while a
    // rejection from the store carries `errors` too. Both are serialised
    // through the same response schema, so it has to allow either.
    const res = await app.inject({
      method: 'PUT', url: '/api/config', cookies: { portal_session: cookie },
      payload: JSON.stringify('not a config'), headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid configuration' });
  });
});
