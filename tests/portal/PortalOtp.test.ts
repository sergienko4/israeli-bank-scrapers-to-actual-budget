import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import PortalConfigStore from '../../src/Portal/PortalConfigStore.js';
import { INTERNAL_ERROR } from '../../src/Portal/PortalValidationError.js';
import { OTP_SUBMIT_MAX } from '../../src/Portal/PortalRateLimit.js';
import { buildPortal } from '../../src/Portal/PortalServer.js';
import OtpRequestStore from '../../src/Services/TwoFactor/OtpRequestStore.js';
import createNodeFileSystem from '../../src/Storage/NodeFileSystem.js';
import { fakePortalRuntime, PORTAL_TEST_PASSWORD, seedConfigDir } from '../helpers/portalFactories.js';

let app: FastifyInstance;
let dir: string;
let requestsPath: string;
let settingsPath: string;
const originalRequestsPath = process.env.OTP_REQUESTS_PATH;
const originalSettingsPath = process.env.OTP_SETTINGS_PATH;

/** A well-formed request id no request was created under. */
const UNKNOWN_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';

/** Windows has no POSIX permission bits; root writes whatever the mode. */
const CANNOT_DENY_WRITES = process.platform === 'win32' || process.getuid?.() === 0;

/**
 * Names the answer file a request's code is published to.
 * @param id - The request id.
 * @returns The answer file path.
 */
function answerPathOf(id: string): string {
  return join(dir, `otp-requests.${id}.answer.json`);
}

/**
 * Logs in with the seeded portal password and returns the session cookie value.
 * @returns The portal_session cookie string.
 */
async function loginCookie(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: PORTAL_TEST_PASSWORD } });
  return res.cookies[0].value;
}

describe('Portal /api/otp', () => {
  beforeEach(async () => {
    const seed = seedConfigDir();
    dir = mkdtempSync(join(tmpdir(), 'portal-otp-'));
    requestsPath = join(dir, 'otp-requests.json');
    settingsPath = join(dir, 'otp-settings.json');
    process.env.OTP_REQUESTS_PATH = requestsPath;
    process.env.OTP_SETTINGS_PATH = settingsPath;
    app = await buildPortal(fakePortalRuntime(), new PortalConfigStore(seed.path));
    rmSync(seed.dir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await app.close();
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
    restoreEnv('OTP_REQUESTS_PATH', originalRequestsPath);
    restoreEnv('OTP_SETTINGS_PATH', originalSettingsPath);
  });

  /**
   * Restores or clears an env var after the test.
   * @param key - The env var name.
   * @param original - The value to restore, or undefined to delete.
   */
  function restoreEnv(key: string, original: string | undefined): void {
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }

  it('guards /api/otp/pending behind auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/otp/pending' });
    expect(res.statusCode).toBe(401);
  });

  it('lists pending requests without codes', async () => {
    new OtpRequestStore(createNodeFileSystem(), requestsPath).create('leumi', 60_000);
    const cookie = await loginCookie();
    const res = await app.inject({ method: 'GET', url: '/api/otp/pending', cookies: { portal_session: cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { requests: { bankId: string; code?: string }[] };
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].bankId).toBe('leumi');
    expect(body.requests[0].code).toBeUndefined();
  });

  it('accepts a valid submitted code', async () => {
    const created = new OtpRequestStore(createNodeFileSystem(), requestsPath).create('leumi', 60_000);
    const cookie = await loginCookie();
    const res = await app.inject({
      method: 'POST', url: `/api/otp/${created.id}`, cookies: { portal_session: cookie }, payload: { code: '123456' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(readFileSync(answerPathOf(created.id), 'utf8'))).toMatchObject({ code: '123456' });
  });

  it('publishes the code owner-only as the request\'s answer, and refuses a second one', async () => {
    const created = new OtpRequestStore(createNodeFileSystem(), requestsPath).create('leumi', 60_000);
    const cookie = await loginCookie();
    const submit = async (code: string): Promise<number> => (await app.inject({
      method: 'POST', url: `/api/otp/${created.id}`, cookies: { portal_session: cookie }, payload: { code },
    })).statusCode;
    expect(await submit('123456')).toBe(200);
    expect(statSync(answerPathOf(created.id)).mode & 0o777).toBe(0o600);
    expect(await submit('654321')).toBe(404);
    expect(readFileSync(answerPathOf(created.id), 'utf8')).toContain('123456');
  });

  it.skipIf(CANNOT_DENY_WRITES)('answers 500 with the generic body when the code cannot be saved', async () => {
    const created = new OtpRequestStore(createNodeFileSystem(), requestsPath).create('leumi', 60_000);
    const cookie = await loginCookie();
    chmodSync(dir, 0o500);
    const res = await app.inject({
      method: 'POST', url: `/api/otp/${created.id}`, cookies: { portal_session: cookie }, payload: { code: '123456' },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: INTERNAL_ERROR });
    expect(res.body).not.toContain('123456');
  });

  it('rejects a malformed code with 400', async () => {
    const created = new OtpRequestStore(createNodeFileSystem(), requestsPath).create('leumi', 60_000);
    const cookie = await loginCookie();
    const res = await app.inject({
      method: 'POST', url: `/api/otp/${created.id}`, cookies: { portal_session: cookie }, payload: { code: 'ab' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for an unknown request id', async () => {
    const cookie = await loginCookie();
    const res = await app.inject({
      method: 'POST', url: `/api/otp/${UNKNOWN_ID}`, cookies: { portal_session: cookie }, payload: { code: '123456' },
    });
    expect(res.statusCode).toBe(404);
  });

  it.each([
    ['a word', 'missing'],
    ['an upper-case UUID', UNKNOWN_ID.toUpperCase()],
    ['an encoded path', `..%2F${UNKNOWN_ID}`],
  ])('rejects %s as a request id with 400', async (_label, id) => {
    const cookie = await loginCookie();
    const res = await app.inject({
      method: 'POST', url: `/api/otp/${id}`, cookies: { portal_session: cookie }, payload: { code: '123456' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid OTP code' });
  });

  it('rate-limits repeated OTP submissions once the per-route maximum is exceeded', async () => {
    const cookie = await loginCookie();
    const attempts = Array.from({ length: OTP_SUBMIT_MAX + 5 }, () => (
      app.inject({
        method: 'POST', url: `/api/otp/${UNKNOWN_ID}`, cookies: { portal_session: cookie }, payload: { code: '123456' },
      })
    ));
    const codes = (await Promise.all(attempts)).map((res) => res.statusCode);
    const accepted = codes.filter((code) => code !== 429);
    expect(accepted.length).toBeLessThanOrEqual(OTP_SUBMIT_MAX);
    expect(codes).toContain(429);
  });

  it('defaults settings to the telegram channel', async () => {
    const cookie = await loginCookie();
    const res = await app.inject({ method: 'GET', url: '/api/otp/settings', cookies: { portal_session: cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ channel: 'telegram' });
  });

  it('sets and reads the app channel', async () => {
    const cookie = await loginCookie();
    const put = await app.inject({
      method: 'PUT', url: '/api/otp/settings', cookies: { portal_session: cookie }, payload: { channel: 'app' },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/otp/settings', cookies: { portal_session: cookie } });
    expect(get.json()).toEqual({ channel: 'app' });
  });

  it('saves the channel owner-only at OTP_SETTINGS_PATH', async () => {
    const cookie = await loginCookie();
    await app.inject({
      method: 'PUT', url: '/api/otp/settings', cookies: { portal_session: cookie }, payload: { channel: 'app' },
    });
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({ channel: 'app' });
    expect(statSync(settingsPath).mode & 0o777).toBe(0o600);
  });

  it('rejects an invalid channel with 400', async () => {
    const cookie = await loginCookie();
    const res = await app.inject({
      method: 'PUT', url: '/api/otp/settings', cookies: { portal_session: cookie }, payload: { channel: 'sms' },
    });
    expect(res.statusCode).toBe(400);
  });
});
