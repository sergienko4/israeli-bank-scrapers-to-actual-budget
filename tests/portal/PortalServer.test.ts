import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import PortalConfigStore from '../../src/Portal/PortalConfigStore.js';
import { buildPortal, startPortal } from '../../src/Portal/PortalServer.js';
import { fakeBankConfig } from '../helpers/factories.js';
import { fakePortalRuntime, PORTAL_TEST_PASSWORD, seedConfigDir } from '../helpers/portalFactories.js';

let app: FastifyInstance;
let dir: string;

/**
 * Logs in with the seeded portal password and returns the session cookie value.
 * @returns The portal_session cookie string.
 */
async function loginCookie(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: PORTAL_TEST_PASSWORD } });
  expect(res.statusCode).toBe(200);
  return res.cookies[0].value;
}

describe('PortalServer routes (password mode)', () => {
  beforeEach(async () => {
    const seed = seedConfigDir();
    dir = seed.dir;
    app = await buildPortal(fakePortalRuntime(), new PortalConfigStore(seed.path));
  });
  afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

  it('reports the auth mode without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/mode' });
    expect(res.json()).toEqual({ authMode: 'password' });
  });

  it('rejects a bad password with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'nope' } });
    expect(res.statusCode).toBe(401);
  });

  it('guards /api/config with 401 when no cookie is present', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.statusCode).toBe(401);
  });

  it('serves masked config and accepts writes when authenticated', async () => {
    const cookie = await loginCookie();
    const masked = await app.inject({ method: 'GET', url: '/api/config', cookies: { portal_session: cookie } });
    expect(masked.statusCode).toBe(200);
    expect(masked.json().banks.discount.password).toBe('********');
    const put = await app.inject({ method: 'PUT', url: '/api/config', cookies: { portal_session: cookie }, payload: masked.json() });
    expect(put.statusCode).toBe(200);
  });

  it('adds then removes a bank via the API', async () => {
    const cookie = await loginCookie();
    const add = await app.inject({ method: 'POST', url: '/api/banks/leumi', cookies: { portal_session: cookie }, payload: fakeBankConfig() });
    expect(add.statusCode).toBe(200);
    const del = await app.inject({ method: 'DELETE', url: '/api/banks/discount', cookies: { portal_session: cookie } });
    expect(del.statusCode).toBe(200);
  });

  it('serves the manifest payload when authenticated', async () => {
    const cookie = await loginCookie();
    const res = await app.inject({ method: 'GET', url: '/api/manifest', cookies: { portal_session: cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.sections)).toBe(true);
    expect(body.banks).toContain('discount');
    expect(body.bankRequirements.discount).toBeDefined();
  });

  it('returns 400 when a config write fails validation', async () => {
    const cookie = await loginCookie();
    const masked = await app.inject({ method: 'GET', url: '/api/config', cookies: { portal_session: cookie } });
    const bad = masked.json();
    bad.actual.budget.syncId = 'not-a-uuid';
    const put = await app.inject({
      method: 'PUT', url: '/api/config', cookies: { portal_session: cookie }, payload: bad,
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().error).toBeTruthy();
  });

  it('returns 400 when adding an unknown bank', async () => {
    const cookie = await loginCookie();
    const add = await app.inject({
      method: 'POST', url: '/api/banks/notabank', cookies: { portal_session: cookie }, payload: fakeBankConfig(),
    });
    expect(add.statusCode).toBe(400);
    expect(add.json().error).toBeTruthy();
  });

  it('returns 400 when removing the only configured bank', async () => {
    const cookie = await loginCookie();
    const del = await app.inject({ method: 'DELETE', url: '/api/banks/discount', cookies: { portal_session: cookie } });
    expect(del.statusCode).toBe(400);
    expect(del.json().error).toBeTruthy();
  });

  it('returns 400 (not 500) when the config body is malformed', async () => {
    const cookie = await loginCookie();
    const put = await app.inject({
      method: 'PUT', url: '/api/config', cookies: { portal_session: cookie },
      payload: { actual: {}, banks: {} },
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().error).toBeTruthy();
  });

  it('runs validation and clears the session on logout', async () => {
    const cookie = await loginCookie();
    const masked = await app.inject({ method: 'GET', url: '/api/config', cookies: { portal_session: cookie } });
    const report = await app.inject({ method: 'POST', url: '/api/validate', cookies: { portal_session: cookie }, payload: masked.json() });
    expect(report.statusCode).toBe(200);
    expect(Array.isArray(report.json())).toBe(true);
    const out = await app.inject({ method: 'POST', url: '/auth/logout', cookies: { portal_session: cookie } });
    expect(out.statusCode).toBe(200);
  });

  it('starts and listens on an ephemeral port', async () => {
    const seed = seedConfigDir();
    const server = await startPortal(fakePortalRuntime({ port: 0 }), seed.path);
    expect(server.server.listening).toBe(true);
    await server.close();
    rmSync(seed.dir, { recursive: true, force: true });
  });
});
