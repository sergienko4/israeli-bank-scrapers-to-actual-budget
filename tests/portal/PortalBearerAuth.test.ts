import { rmSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import PortalConfigStore from '../../src/Portal/PortalConfigStore.js';
import { buildPortal } from '../../src/Portal/PortalServer.js';
import { fakeImporterConfig } from '../helpers/factories.js';
import {
  fakePortalConfig, fakePortalRuntime, PORTAL_TEST_PASSWORD, seedConfigDir,
} from '../helpers/portalFactories.js';

let app: FastifyInstance;
let dir: string;

/**
 * Requests a bearer token with the seeded portal password.
 * @returns The issued bearer token string.
 */
async function issueToken(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/token', payload: { password: PORTAL_TEST_PASSWORD } });
  expect(res.statusCode).toBe(200);
  return res.json().token as string;
}

describe('Portal bearer-token auth (native/API clients)', () => {
  beforeEach(async () => {
    const seed = seedConfigDir();
    dir = seed.dir;
    app = await buildPortal(fakePortalRuntime(), new PortalConfigStore(seed.path));
  });
  afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

  it('issues a non-empty token for the correct password', async () => {
    const token = await issueToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('rejects a wrong password with 401 and no token', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/token', payload: { password: 'nope' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().token).toBeUndefined();
  });

  it('rejects a non-string password with 401 instead of a 500', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/token', payload: { password: 123 } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a token request with no JSON body with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/token' });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a valid bearer token on /api/config', async () => {
    const token = await issueToken();
    const res = await app.inject({
      method: 'GET', url: '/api/config', headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().banks).toBeDefined();
  });

  it('accepts a lowercase bearer scheme (case-insensitive)', async () => {
    const token = await issueToken();
    const res = await app.inject({
      method: 'GET', url: '/api/config', headers: { authorization: `bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('reports the caller authorized on /auth/status with a bearer token', async () => {
    const token = await issueToken();
    const res = await app.inject({
      method: 'GET', url: '/auth/status', headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json()).toMatchObject({ authMode: 'password', password: true, authorized: true });
  });

  it('rejects a garbage bearer token with 401', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/config', headers: { authorization: 'Bearer not.a.token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an Authorization header carrying the wrong scheme with 401', async () => {
    const token = await issueToken();
    const res = await app.inject({
      method: 'GET', url: '/api/config', headers: { authorization: `Token ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an access token pasted into the session cookie with 401', async () => {
    const token = await issueToken();
    const res = await app.inject({
      method: 'GET', url: '/api/config', cookies: { portal_session: token },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a bearer token on a write (PUT /api/config)', async () => {
    const token = await issueToken();
    const masked = await app.inject({
      method: 'GET', url: '/api/config', headers: { authorization: `Bearer ${token}` },
    });
    const put = await app.inject({
      method: 'PUT', url: '/api/config', headers: { authorization: `Bearer ${token}` }, payload: masked.json(),
    });
    expect(put.statusCode).toBe(200);
  });

  it('evicts a bearer token once the portal password changes', async () => {
    const token = await issueToken();
    const masked = await app.inject({
      method: 'GET', url: '/api/config', headers: { authorization: `Bearer ${token}` },
    });
    const changed = masked.json();
    changed.portal.passwordHash = 'a-brand-new-portal-password';
    const put = await app.inject({
      method: 'PUT', url: '/api/config', headers: { authorization: `Bearer ${token}` }, payload: changed,
    });
    expect(put.statusCode).toBe(200);
    const after = await app.inject({
      method: 'GET', url: '/api/config', headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it('rate-limits the token route once its per-route maximum is exceeded', async () => {
    const attempts = Array.from({ length: 15 }, () => (
      app.inject({ method: 'POST', url: '/auth/token', payload: { password: 'nope' } })
    ));
    const codes = (await Promise.all(attempts)).map((res) => res.statusCode);
    expect(codes).toContain(429);
  });

  it('does not authorize a bearer-only session when authMode is both', async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    const seed = seedConfigDir(fakeImporterConfig({ portal: fakePortalConfig({ authMode: 'both' }) }));
    dir = seed.dir;
    app = await buildPortal(
      fakePortalRuntime({ portal: fakePortalConfig({ authMode: 'both' }) }),
      new PortalConfigStore(seed.path),
    );
    const token = await issueToken();
    const res = await app.inject({
      method: 'GET', url: '/api/config', headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
