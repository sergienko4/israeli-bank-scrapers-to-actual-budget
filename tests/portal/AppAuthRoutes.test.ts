import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppAuthCodes } from '../../src/Portal/AppAuthCodes.js';
import { registerAppAuthRoutes, type SessionResolver } from '../../src/Portal/AppAuthRoutes.js';
import type { IPortalRuntime } from '../../src/Portal/PortalRuntime.js';
import { credentialFingerprint } from '../../src/Portal/PortalRuntime.js';
import type { ISessionPayload } from '../../src/Portal/PortalSession.js';
import { fail, succeed } from '../../src/Types/Index.js';
import { fakePortalConfig, fakePortalRuntime } from '../helpers/portalFactories.js';

const REDIRECT = 'bankimporter://auth';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

let app: FastifyInstance;
let codes: AppAuthCodes;
let runtime: IPortalRuntime;
let session: ISessionPayload | null;

/**
 * Builds a runtime whose app block is enabled with a single redirect URI.
 * @param overrides - Portal app fields to override.
 * @returns Portal runtime fixture.
 */
function enabledRuntime(overrides: Record<string, unknown> = {}): IPortalRuntime {
  const portal = fakePortalConfig({
    app: { enabled: true, redirectUris: [REDIRECT], ...overrides },
  });
  return fakePortalRuntime({ portal });
}

/**
 * Builds an authorized cookie session for the current runtime.
 * @returns Session payload satisfying password mode.
 */
function authorizedSession(): ISessionPayload {
  return {
    google: false,
    password: true,
    expires: Date.now() + 60_000,
    fingerprint: credentialFingerprint(runtime),
    typ: 'cookie',
  };
}

/** Resolver returning whatever the current test parked in `session`. */
const resolver: SessionResolver = () => (
  session ? succeed(session) : fail('No session cookie')
);

/**
 * Builds the authorize URL from the given query parameters.
 * @param overrides - Query parameters to override on the valid defaults.
 * @returns Authorize URL including its query string.
 */
function authorizeUrl(overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'state-123',
    ...overrides,
  });
  const query = params.toString();
  return `/auth/app/authorize?${query}`;
}

/**
 * Asks for a code the way an operator does: request it, then approve.
 *
 * The portal sends the browser to the approval page before it mints anything,
 * so a test that wants the redirect has to come back with the token that page
 * was handed.
 * @param url - The authorize URL to request.
 * @returns The reply to the approving request.
 */
async function approve(url: string): Promise<LightMyRequestResponse> {
  const asked = await app.inject({ method: 'GET', url });
  const sent = String(asked.headers.location);
  if (!sent.startsWith('/approve.html?')) return asked;
  const query = sent.slice(sent.indexOf('?') + 1);
  return await app.inject({ method: 'GET', url: `/auth/app/authorize?${query}` });
}

describe('AppAuthRoutes authorize', () => {
  beforeEach(async () => {
    runtime = enabledRuntime();
    codes = new AppAuthCodes();
    session = null;
    app = Fastify({ logger: false });
    await app.register(cookie, { secret: runtime.sessionSecret });
    registerAppAuthRoutes(app, { live: () => runtime, codes, sessionOf: resolver });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('reports 503 when app sign-in is disabled', async () => {
    runtime = fakePortalRuntime();
    const res = await app.inject({ method: 'GET', url: authorizeUrl() });
    expect(res.statusCode).toBe(503);
  });

  it('rejects an unknown redirect_uri without redirecting', async () => {
    const res = await app.inject({ method: 'GET', url: authorizeUrl({ redirect_uri: 'evil://x' }) });
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it('rejects a missing redirect_uri', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/app/authorize' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a malformed code_challenge', async () => {
    const res = await app.inject({ method: 'GET', url: authorizeUrl({ code_challenge: 'short' }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_code_challenge');
  });

  it('rejects the plain challenge method', async () => {
    const res = await app.inject({ method: 'GET', url: authorizeUrl({ code_challenge_method: 'plain' }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('unsupported_challenge_method');
  });

  it('rejects a state carrying characters outside the allowed set', async () => {
    const res = await app.inject({ method: 'GET', url: authorizeUrl({ state: 'a b' }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_state');
  });

  it('rejects an over-long state', async () => {
    const res = await app.inject({ method: 'GET', url: authorizeUrl({ state: 'a'.repeat(129) }) });
    expect(res.statusCode).toBe(400);
  });

  it('bounces an anonymous caller to the login UI', async () => {
    const res = await app.inject({ method: 'GET', url: authorizeUrl() });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/?next=%2Fauth%2Fapp%2Fauthorize');
  });

  it('bounces a session that does not yet satisfy the auth mode', async () => {
    runtime = enabledRuntime();
    runtime.authMode = 'both';
    session = authorizedSession();
    const res = await app.inject({ method: 'GET', url: authorizeUrl() });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/?next=');
  });

  it('asks an authorized caller to approve before minting anything', async () => {
    session = authorizedSession();
    const res = await app.inject({ method: 'GET', url: authorizeUrl() });
    expect(res.statusCode).toBe(302);
    expect(String(res.headers.location)).toContain('/approve.html?');
    expect(String(res.headers.location)).toContain('consent=');
    expect(codes.size).toBe(0);
  });

  it('refuses an approval minted for a different request', async () => {
    session = authorizedSession();
    const other = await app.inject({ method: 'GET', url: authorizeUrl({ state: 'other-state' }) });
    const match = /consent=([^"&]+)/.exec(String(other.headers.location));
    const stolen = decodeURIComponent(String(match?.[1]));
    const url = `${authorizeUrl()}&consent=${encodeURIComponent(stolen)}`;
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(302);
    expect(String(res.headers.location)).toContain('/approve.html?');
    expect(codes.size).toBe(0);
  });

  it('still approves after a rejected token, rather than asking forever', async () => {
    session = authorizedSession();
    const stale = `${authorizeUrl()}&consent=${encodeURIComponent('1.dead')}`;
    const res = await approve(stale);
    expect(res.statusCode).toBe(302);
    expect(String(res.headers.location).startsWith(REDIRECT)).toBe(true);
    expect(codes.size).toBe(1);
  });

  it('redirects an authorized caller to the app with a code', async () => {
    session = authorizedSession();
    const res = await approve(authorizeUrl());
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^bankimporter:\/\/auth\?code=[\w-]+&state=state-123$/);
    expect(codes.size).toBe(1);
  });

  it('echoes the state verbatim', async () => {
    session = authorizedSession();
    const res = await approve(authorizeUrl({ state: 'a-b._~9' }));
    expect(res.headers.location).toContain('&state=a-b._~9');
  });

  it('records the sanitized device name on the code', async () => {
    session = authorizedSession();
    const res = await approve(authorizeUrl({ device_name: 'Pixel\u00009' }));
    const code = String(res.headers.location).split('code=')[1].split('&')[0];
    const record = codes.redeem(code, Date.now());
    expect(record.success && record.data.deviceName).toBe('Pixel9');
  });

  it('records the live factors and fingerprint on the code', async () => {
    session = authorizedSession();
    const res = await approve(authorizeUrl());
    const code = String(res.headers.location).split('code=')[1].split('&')[0];
    const record = codes.redeem(code, Date.now());
    expect(record.success && record.data.fingerprint).toBe(credentialFingerprint(runtime));
    expect(record.success && record.data.factors.password).toBe(true);
  });

  it('binds the code to the requested redirect URI', async () => {
    session = authorizedSession();
    const res = await approve(authorizeUrl());
    const code = String(res.headers.location).split('code=')[1].split('&')[0];
    const record = codes.redeem(code, Date.now());
    expect(record.success && record.data.redirectUri).toBe(REDIRECT);
    expect(record.success && record.data.challenge).toBe(CHALLENGE);
  });

  it('reports 503 when the allow-list is empty', async () => {
    runtime = enabledRuntime({ redirectUris: [] });
    const res = await app.inject({ method: 'GET', url: authorizeUrl() });
    expect(res.statusCode).toBe(503);
  });
});
