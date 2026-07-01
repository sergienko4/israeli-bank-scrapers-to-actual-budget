import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import PortalConfigStore from '../../src/Portal/PortalConfigStore.js';
import { buildPortal, startPortal } from '../../src/Portal/PortalServer.js';
import { fakeBankConfig, fakeValidBankConfigFor } from '../helpers/factories.js';
import { fakePortalConfig, fakePortalRuntime, PORTAL_TEST_PASSWORD, seedConfigDir } from '../helpers/portalFactories.js';

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

  it('reports auth status with no factors when there is no session', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/status' });
    expect(res.json()).toEqual({
      authMode: 'password', google: false, password: false, email: null, authorized: false,
    });
  });

  it('reports the password factor satisfied after a successful login', async () => {
    const cookie = await loginCookie();
    const res = await app.inject({ method: 'GET', url: '/auth/status', cookies: { portal_session: cookie } });
    expect(res.json()).toMatchObject({ authMode: 'password', password: true, authorized: true });
  });

  it('rejects a bad password with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'nope' } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a non-string password with 401 instead of a 500', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 123 } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a login with no JSON body with 401 instead of a 500', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login' });
    expect(res.statusCode).toBe(401);
  });

  it('rate-limits the login route once its per-route maximum is exceeded', async () => {
    const attempts = Array.from({ length: 15 }, () => (
      app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'nope' } })
    ));
    const codes = (await Promise.all(attempts)).map((res) => res.statusCode);
    expect(codes).toContain(429);
  });

  it('guards /api/config with 401 when no cookie is present', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.statusCode).toBe(401);
  });

  it('guards a percent-encoded /api path that decodes to a real route', async () => {
    const res = await app.inject({ method: 'GET', url: '/%61pi/config' });
    expect(res.statusCode).toBe(401);
  });

  it('returns a JSON 404 (not the SPA shell) for an unknown /api route', async () => {
    const cookie = await loginCookie();
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist', cookies: { portal_session: cookie } });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json().error).toBe('Not found');
  });

  it('returns a JSON 404 for an unknown /auth route instead of HTML', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/loguot', payload: {} });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Not found');
  });

  it('returns a JSON 404 (not the SPA shell) for the exact /api root', async () => {
    const res = await app.inject({ method: 'GET', url: '/api' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json().error).toBe('Not found');
  });

  it('returns a JSON 404 (not the SPA shell) for the exact /auth root', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json().error).toBe('Not found');
  });

  it('still serves the SPA shell for an unknown non-API front-end route', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('serves the SPA shell for a front-end route that carries a query string', async () => {
    const res = await app.inject({ method: 'GET', url: '/report?ref=a.b' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.payload).toContain('Importer Config Portal');
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
    const add = await app.inject({ method: 'POST', url: '/api/banks/leumi', cookies: { portal_session: cookie }, payload: fakeValidBankConfigFor('leumi') });
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

  it('serves the generated config schema when authenticated', async () => {
    const cookie = await loginCookie();
    const res = await app.inject({ method: 'GET', url: '/api/schema', cookies: { portal_session: cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.type).toBe('object');
    expect(body.properties.banks['x-bank-map']).toBe(true);
  });

  it('guards /api/schema with 401 when no cookie is present', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/schema' });
    expect(res.statusCode).toBe(401);
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

  it('returns 400 when the proxy section is invalid (write-gate parity)', async () => {
    const cookie = await loginCookie();
    const masked = await app.inject({ method: 'GET', url: '/api/config', cookies: { portal_session: cookie } });
    const bad = masked.json();
    bad.proxy = { server: '10.0.0.1:1080' };
    const put = await app.inject({
      method: 'PUT', url: '/api/config', cookies: { portal_session: cookie }, payload: bad,
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().error).toBeTruthy();
  });

  it('returns 400 when a spendingWatch rule is incomplete (write-gate parity)', async () => {
    const cookie = await loginCookie();
    const masked = await app.inject({ method: 'GET', url: '/api/config', cookies: { portal_session: cookie } });
    const bad = masked.json();
    bad.spendingWatch = [{ alertFromAmount: 100 }];
    const put = await app.inject({
      method: 'PUT', url: '/api/config', cookies: { portal_session: cookie }, payload: bad,
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().error).toBeTruthy();
  });

  it('returns 400 when a bank is missing a required credential (write-gate parity)', async () => {
    const cookie = await loginCookie();
    const masked = await app.inject({ method: 'GET', url: '/api/config', cookies: { portal_session: cookie } });
    const bad = masked.json();
    bad.banks.discount.password = '';
    const put = await app.inject({
      method: 'PUT', url: '/api/config', cookies: { portal_session: cookie }, payload: bad,
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().error).toBeTruthy();
  });

  it('returns 400 when the Actual serverURL scheme is malformed (write-gate parity)', async () => {
    const cookie = await loginCookie();
    const masked = await app.inject({ method: 'GET', url: '/api/config', cookies: { portal_session: cookie } });
    const bad = masked.json();
    bad.actual.init.serverURL = 'httptypo://localhost:5006';
    const put = await app.inject({
      method: 'PUT', url: '/api/config', cookies: { portal_session: cookie }, payload: bad,
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().error).toBeTruthy();
  });

  it('returns 400 when enabling a portal whose auth config can log nobody in', async () => {
    const cookie = await loginCookie();
    const masked = await app.inject({ method: 'GET', url: '/api/config', cookies: { portal_session: cookie } });
    const bad = masked.json();
    bad.portal = fakePortalConfig({ authMode: 'google' });
    const put = await app.inject({
      method: 'PUT', url: '/api/config', cookies: { portal_session: cookie }, payload: bad,
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().error).toBeTruthy();
  });

  it('returns 400 (not 500) when /api/validate receives a body that throws', async () => {
    const cookie = await loginCookie();
    const res = await app.inject({
      method: 'POST', url: '/api/validate', cookies: { portal_session: cookie }, payload: { banks: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it('returns 500 when persisting fails because the config dir is gone', async () => {
    const cookie = await loginCookie();
    const masked = await app.inject({ method: 'GET', url: '/api/config', cookies: { portal_session: cookie } });
    rmSync(dir, { recursive: true, force: true });
    const put = await app.inject({
      method: 'PUT', url: '/api/config', cookies: { portal_session: cookie }, payload: masked.json(),
    });
    expect(put.statusCode).toBe(500);
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
    const setCookie = out.headers['set-cookie'];
    const cleared = (Array.isArray(setCookie) ? setCookie : [String(setCookie)])
      .find(entry => entry.startsWith('portal_session='));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/max-age=0|expires=thu, 01 jan 1970/i);
  });

  it('starts and listens on an ephemeral port', async () => {
    const seed = seedConfigDir();
    const server = await startPortal(fakePortalRuntime({ port: 0 }), seed.path);
    expect(server.server.listening).toBe(true);
    await server.close();
    rmSync(seed.dir, { recursive: true, force: true });
  });
});
