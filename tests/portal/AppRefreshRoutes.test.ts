import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerAppRefreshRoutes } from '../../src/Portal/AppRefreshRoutes.js';
import { AppTokenStore, type TokenGrant } from '../../src/Portal/AppTokenStore.js';
import { credentialFingerprint, type IPortalRuntime } from '../../src/Portal/PortalRuntime.js';
import { verifyToken } from '../../src/Portal/PortalTokenAuth.js';
import { fakePortalConfig, fakePortalRuntime } from '../helpers/portalFactories.js';

const REDIRECT = 'bankimporter://auth';

let app: FastifyInstance;
let tokens: AppTokenStore;
let runtime: IPortalRuntime;
let dir: string;

/**
 * Builds a runtime with app sign-in enabled.
 * @param authMode - Auth mode the portal should enforce.
 * @returns Portal runtime fixture.
 */
function enabledRuntime(authMode: IPortalRuntime['authMode'] = 'password'): IPortalRuntime {
  const portal = fakePortalConfig({
    authMode,
    app: { enabled: true, redirectUris: [REDIRECT] },
  });
  return fakePortalRuntime({ portal });
}

/**
 * Issues a refresh token the way a successful code exchange would.
 * @param overrides - Fields to override on the grant.
 * @returns The clear refresh token handed to the app.
 */
function issueToken(overrides: Partial<TokenGrant> = {}): string {
  const fingerprint = credentialFingerprint(runtime);
  const grant: TokenGrant = {
    deviceName: 'Pixel',
    factors: { google: false, password: true },
    fingerprint,
    ...overrides,
  };
  const issued = tokens.issue(grant);
  return issued.token;
}

/**
 * Posts to one of the refresh endpoints.
 * @param url - Route to post to.
 * @param body - Request body to send.
 * @returns The Fastify inject response.
 */
async function post(url: string, body: Record<string, unknown>): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'POST', url, payload: body });
}

describe('AppRefreshRoutes', () => {
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'app-refresh-'));
    runtime = enabledRuntime();
    tokens = new AppTokenStore(join(dir, 'app-tokens.json'));
    app = Fastify({ logger: false });
    registerAppRefreshRoutes(app, { live: () => runtime, tokens });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports 503 when app sign-in is disabled', async () => {
    runtime = fakePortalRuntime();
    const res = await post('/auth/app/refresh', { refreshToken: 'x' });
    expect(res.statusCode).toBe(503);
  });

  it('rejects a body without a refresh token', async () => {
    const res = await post('/auth/app/refresh', {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
  });

  it('rejects an unknown refresh token', async () => {
    const res = await post('/auth/app/refresh', { refreshToken: 'nope' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_grant');
  });

  it('returns a fresh pair and a working access token', async () => {
    const token = issueToken();
    const res = await post('/auth/app/refresh', { refreshToken: token });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tokenType).toBe('Bearer');
    expect(body.expiresIn).toBe(900);
    expect(body.refreshToken).not.toBe(token);
    const verified = verifyToken(body.accessToken, runtime, 'access');
    expect(verified.success).toBe(true);
  });

  it('refuses the old token once it has been rotated', async () => {
    const token = issueToken();
    const first = await post('/auth/app/refresh', { refreshToken: token });
    expect(first.statusCode).toBe(200);
    const second = await post('/auth/app/refresh', { refreshToken: token });
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe('invalid_grant');
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    const token = issueToken();
    const first = await post('/auth/app/refresh', { refreshToken: token });
    const rotated = first.json().refreshToken;
    await post('/auth/app/refresh', { refreshToken: token });
    const res = await post('/auth/app/refresh', { refreshToken: rotated });
    expect(res.statusCode).toBe(400);
    expect(tokens.list()).toHaveLength(0);
  });

  it('refuses a token minted against different credentials', async () => {
    const token = issueToken({ fingerprint: 'stale-fingerprint' });
    const res = await post('/auth/app/refresh', { refreshToken: token });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_grant');
    expect(tokens.list()).toHaveLength(0);
  });

  it('refuses a token whose factors no longer satisfy the live auth mode', async () => {
    const token = issueToken();
    runtime = enabledRuntime('both');
    const res = await post('/auth/app/refresh', { refreshToken: token });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_grant');
  });

  it('revokes a refresh token and everything issued alongside it', async () => {
    const token = issueToken();
    const res = await post('/auth/app/revoke', { refreshToken: token });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(tokens.list()).toHaveLength(0);
  });

  it('answers a revoke the same way for a token that never existed', async () => {
    const res = await post('/auth/app/revoke', { refreshToken: 'never-issued' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('answers a revoke without a token the same way', async () => {
    const res = await post('/auth/app/revoke', {});
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});
