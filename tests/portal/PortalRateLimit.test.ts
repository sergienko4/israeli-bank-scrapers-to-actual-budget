import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppAuthCodes } from '../../src/Portal/AppAuthCodes.js';
import { registerAppAuthRoutes } from '../../src/Portal/AppAuthRoutes.js';
import { registerAppRefreshRoutes } from '../../src/Portal/AppRefreshRoutes.js';
import { registerAppTokenRoutes } from '../../src/Portal/AppTokenRoutes.js';
import { AppTokenStore } from '../../src/Portal/AppTokenStore.js';
import {
  LOGIN_MAX, OAUTH_MAX, RATE_WINDOW, REFRESH_MAX, STATUS_MAX,
} from '../../src/Portal/PortalRateLimit.js';
import { fail } from '../../src/Types/Index.js';
import { fakePortalRuntime } from '../helpers/portalFactories.js';

let app: FastifyInstance;
let dir: string;

/**
 * Reads the advertised per-route ceiling from a request to that route.
 * @param method - HTTP method of the route.
 * @param url - Route to probe.
 * @returns The `x-ratelimit-limit` header value as a number.
 */
async function limitOf(method: 'GET' | 'POST', url: string): Promise<number> {
  const res = await app.inject({ method, url, payload: {} });
  return Number(res.headers['x-ratelimit-limit']);
}

describe('PortalRateLimit', () => {
  it('caps password login no looser than the other auth routes (anti-brute-force)', () => {
    expect(LOGIN_MAX).toBeLessThanOrEqual(OAUTH_MAX);
    expect(OAUTH_MAX).toBeLessThanOrEqual(STATUS_MAX);
  });

  it('uses a positive request ceiling for every auth route', () => {
    for (const max of [LOGIN_MAX, OAUTH_MAX, STATUS_MAX, REFRESH_MAX]) expect(max).toBeGreaterThan(0);
  });

  it('shares one sliding window in @fastify/rate-limit syntax', () => {
    expect(RATE_WINDOW).toMatch(/^\d+ (second|minute|hour)s?$/);
  });
});

describe('PortalRateLimit app routes', () => {
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'rate-limit-'));
    const runtime = fakePortalRuntime();
    const live = (): ReturnType<typeof fakePortalRuntime> => runtime;
    const codes = new AppAuthCodes();
    const tokens = new AppTokenStore(join(dir, 'app-tokens.json'));
    app = Fastify({ logger: false });
    await app.register(rateLimit, { global: false });
    registerAppAuthRoutes(app, { live, codes, sessionOf: () => fail('No session') });
    registerAppTokenRoutes(app, { live, codes, tokens });
    registerAppRefreshRoutes(app, { live, tokens });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('caps the authorize route at the OAuth ceiling', async () => {
    expect(await limitOf('GET', '/auth/app/authorize')).toBe(OAUTH_MAX);
  });

  it('caps the token route at the login ceiling', async () => {
    expect(await limitOf('POST', '/auth/app/token')).toBe(LOGIN_MAX);
  });

  it('caps the refresh route at the refresh ceiling', async () => {
    expect(await limitOf('POST', '/auth/app/refresh')).toBe(REFRESH_MAX);
  });

  it('caps the revoke route at the login ceiling', async () => {
    expect(await limitOf('POST', '/auth/app/revoke')).toBe(LOGIN_MAX);
  });
});
