/**
 * A portal route that fails on the server answers one generic 500 body and
 * logs the detail, so no path or errno reaches the client. A client error
 * (a refused schema, a body too large, a rate limit) keeps its own answer.
 */

import { rmSync } from 'node:fs';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  getLogBuffer: vi.fn(),
  deriveLogFormat: vi.fn(() => 'words'),
}));

const { ERROR_BODY } = await import('../../src/Contract/Common.js');
const { AppTokenStore } = await import('../../src/Portal/AppTokenStore.js');
const { default: PortalConfigStore } = await import('../../src/Portal/PortalConfigStore.js');
const { LOGIN_MAX } = await import('../../src/Portal/PortalRateLimit.js');
const schemas = await import('../../src/Portal/PortalRouteSchemas.js');
const { buildPortal } = await import('../../src/Portal/PortalServer.js');
const { default: openPortalStores } = await import('../../src/Portal/PortalStores.js');
const { handlePortalError } = await import('../../src/Portal/PortalValidationError.js');
const { default: DeviceTokenStore } = await import('../../src/Services/Notifications/DeviceTokenStore.js');
const { fakePortalRuntime, PORTAL_TEST_PASSWORD, seedConfigDir } = await import('../helpers/portalFactories.js');
const { default: FakeFileSystem } = await import('../storage/FakeFileSystem.js');

/** The one body every server-side failure answers with. */
const GENERIC_500 = { error: 'Internal server error' };

/** A file path that must never reach a client. */
const TOKENS_PATH = '/data/app-tokens.json';

/**
 * Builds a filesystem whose every open for reading is refused.
 * @returns The filesystem.
 */
function unreadableFileSystem(): InstanceType<typeof FakeFileSystem> {
  const fileSystem = new FakeFileSystem();
  fileSystem.forcedFailures.set('openForRead', 'EACCES');
  return fileSystem;
}

/**
 * Collects every logged error line.
 * @returns The error lines.
 */
function loggedErrors(): string[] {
  return mockLogger.error.mock.calls.map((call) => String(call[0]));
}

describe('portal server errors, through the portal', () => {
  let portal: FastifyInstance;
  let seedDir: string;

  beforeEach(async () => {
    mockLogger.error.mockClear();
    const seed = seedConfigDir();
    seedDir = seed.dir;
    const fileSystem = unreadableFileSystem();
    const stores = {
      ...openPortalStores(),
      appTokens: () => new AppTokenStore(fileSystem, TOKENS_PATH),
      devices: () => new DeviceTokenStore(fileSystem, '/data/device-tokens.json'),
    };
    portal = await buildPortal(fakePortalRuntime(), new PortalConfigStore(seed.path), stores);
  });

  afterEach(async () => {
    await portal.close();
    rmSync(seedDir, { recursive: true, force: true });
  });

  it('answers a failed app sign-out with the generic body and logs the detail', async () => {
    const res = await portal.inject({
      method: 'POST', url: '/auth/app/revoke', payload: { refreshToken: 'any-token' },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual(GENERIC_500);
    expect(res.body).not.toContain(TOKENS_PATH);
    expect(loggedErrors().join('\n')).toContain('Could not read the app tokens');
    expect(loggedErrors().join('\n')).toContain('/auth/app/revoke');
  });

  it('answers a failed device registration with the generic body', async () => {
    const login = await portal.inject({
      method: 'POST', url: '/auth/login', payload: { password: PORTAL_TEST_PASSWORD },
    });
    const res = await portal.inject({
      method: 'POST', url: '/api/devices',
      cookies: { portal_session: login.cookies[0].value },
      payload: { token: 'ExponentPushToken[abc]' },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual(GENERIC_500);
    expect(res.body).not.toContain('/data/');
  });

  it('keeps the answer to a body that is too large', async () => {
    const res = await portal.inject({
      method: 'POST', url: '/auth/app/revoke',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ refreshToken: 'x'.repeat(2 * 1024 * 1024) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).not.toBe(GENERIC_500.error);
    expect(loggedErrors()).toEqual([]);
  });

  it('keeps the answer to a rate-limited request', async () => {
    const attempt = { method: 'POST' as const, url: '/auth/login', payload: { password: 'nope' } };
    for (let sent = 0; sent < LOGIN_MAX; sent++) await portal.inject(attempt);
    const res = await portal.inject(attempt);
    expect(res.statusCode).toBe(429);
    expect(res.json().error).not.toBe(GENERIC_500.error);
    expect(loggedErrors()).toEqual([]);
  });

  it('keeps the answer to a body that is not JSON', async () => {
    const res = await portal.inject({
      method: 'POST', url: '/auth/app/revoke',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(loggedErrors()).toEqual([]);
  });
});

describe('handlePortalError', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    mockLogger.error.mockClear();
    app = Fastify({ logger: false });
    app.setErrorHandler(handlePortalError);
    app.get('/plain', () => { throw new Error('boom at /secret/path'); });
    app.get('/gateway', () => {
      throw Object.assign(new Error('upstream at /secret/path'), { statusCode: 502 });
    });
    app.get('/teapot', () => {
      throw Object.assign(new Error('Short and stout'), { statusCode: 418 });
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ['an error without a status', '/plain'],
    ['an error with a 5xx status', '/gateway'],
  ])('answers %s with the generic 500 body and logs it', async (_label, url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual(GENERIC_500);
    expect(loggedErrors()).toHaveLength(1);
    expect(loggedErrors()[0]).toContain('/secret/path');
    expect(loggedErrors()[0]).toContain(`GET ${url}`);
  });

  it('passes a 4xx error through unchanged, without logging it', async () => {
    const res = await app.inject({ method: 'GET', url: '/teapot' });
    expect(res.statusCode).toBe(418);
    expect(res.json().message).toBe('Short and stout');
    expect(loggedErrors()).toEqual([]);
  });
});

describe('the contract of the routes whose store can fail', () => {
  it.each([
    ['POST /auth/app/token and /auth/app/refresh', schemas.APP_GRANT_SCHEMA.response],
    ['POST /auth/app/revoke', schemas.APP_REVOKE_SCHEMA.response],
    ['DELETE /api/app/sessions/:id', schemas.APP_SESSION_REVOKE_SCHEMA.response],
    ['POST and DELETE /api/devices', schemas.DEVICE_ROUTE.schema.response],
    ['POST /api/otp/:id', schemas.OTP_SUBMIT_SCHEMA.response],
    ['PUT /api/otp/settings', schemas.OTP_SETTINGS_WRITE_SCHEMA.response],
  ])('declares the generic body for a 500 from %s', (_route, responses) => {
    expect(responses[500]).toBe(ERROR_BODY);
  });
});
