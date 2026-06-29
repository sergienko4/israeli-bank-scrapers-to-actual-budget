import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import PortalConfigStore from '../../src/Portal/PortalConfigStore.js';
import { buildPortal } from '../../src/Portal/PortalServer.js';
import { fakeGoogleConfig, fakePortalConfig, fakePortalRuntime, seedConfigDir } from '../helpers/portalFactories.js';

let app: FastifyInstance;
let dir: string;

/**
 * Builds an id_token JWT carrying the email claim for token-exchange mocks.
 * @param email - Email claim to embed.
 * @returns Compact JWT string.
 */
function jwtWithEmail(email: string): string {
  return `h.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.s`;
}

describe('PortalGoogleRoutes', () => {
  beforeEach(async () => {
    const seed = seedConfigDir();
    dir = seed.dir;
    const portal = fakePortalConfig({ authMode: 'google', google: fakeGoogleConfig() });
    app = await buildPortal(fakePortalRuntime({ authMode: 'google', portal }), new PortalConfigStore(seed.path));
  });
  afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); });

  it('redirects to Google consent', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/google' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
  });

  it('returns 400 when callback has no code', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/google/callback' });
    expect(res.statusCode).toBe(400);
  });

  it('grants a session and redirects when the email is allowed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ id_token: jwtWithEmail('allowed@example.com') }) }));
    const res = await app.inject({ method: 'GET', url: '/auth/google/callback?code=ok' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  it('returns 403 when the email is not allow-listed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ id_token: jwtWithEmail('intruder@example.com') }) }));
    const res = await app.inject({ method: 'GET', url: '/auth/google/callback?code=ok' });
    expect(res.statusCode).toBe(403);
  });

  it('skips Google routes when unconfigured (SPA fallback)', async () => {
    const seed = seedConfigDir();
    const plain = await buildPortal(fakePortalRuntime(), new PortalConfigStore(seed.path));
    const res = await plain.inject({ method: 'GET', url: '/auth/google' });
    expect(res.statusCode).toBe(200);
    expect(res.headers.location).toBeUndefined();
    await plain.close();
    rmSync(seed.dir, { recursive: true, force: true });
  });
});
