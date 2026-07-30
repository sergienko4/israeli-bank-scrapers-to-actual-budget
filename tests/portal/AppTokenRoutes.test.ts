import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppAuthCodes, type AuthCodeInput } from '../../src/Portal/AppAuthCodes.js';
import { AppTokenStore } from '../../src/Portal/AppTokenStore.js';
import { registerAppTokenRoutes } from '../../src/Portal/AppTokenRoutes.js';
import { credentialFingerprint, type IPortalRuntime } from '../../src/Portal/PortalRuntime.js';
import { verifyToken } from '../../src/Portal/PortalTokenAuth.js';
import { fakePortalConfig, fakePortalRuntime } from '../helpers/portalFactories.js';

const REDIRECT = 'bankimporter://auth';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

let app: FastifyInstance;
let codes: AppAuthCodes;
let tokens: AppTokenStore;
let runtime: IPortalRuntime;
let dir: string;

/**
 * Builds a runtime with app sign-in enabled.
 * @param authMode - Auth mode the portal should enforce.
 * @returns Portal runtime fixture.
 */
function enabledRuntime(authMode = 'password'): IPortalRuntime {
  const portal = fakePortalConfig({
    authMode: authMode as IPortalRuntime['authMode'],
    app: { enabled: true, redirectUris: [REDIRECT] },
  });
  return fakePortalRuntime({ portal });
}

/**
 * Mints an authorization code bound to the RFC test challenge.
 * @param overrides - Fields to override on the minted code.
 * @returns The minted code string.
 */
function mintCode(overrides: Partial<AuthCodeInput> = {}): string {
  const fingerprint = credentialFingerprint(runtime);
  const input: AuthCodeInput = {
    challenge: CHALLENGE,
    redirectUri: REDIRECT,
    factors: { google: false, password: true },
    fingerprint,
    deviceName: 'Pixel',
    ...overrides,
  };
  const record = codes.mint(input);
  return record.code;
}

/**
 * Posts a token request.
 * @param body - Request body to send.
 * @returns The Fastify inject response.
 */
async function post(body: Record<string, unknown>): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'POST', url: '/auth/app/token', payload: body });
}

describe('AppTokenRoutes', () => {
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'app-tokens-'));
    runtime = enabledRuntime();
    codes = new AppAuthCodes();
    tokens = new AppTokenStore(join(dir, 'app-tokens.json'));
    app = Fastify({ logger: false });
    registerAppTokenRoutes(app, { live: () => runtime, codes, tokens });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports 503 when app sign-in is disabled', async () => {
    runtime = fakePortalRuntime();
    const res = await post({ code: 'x', code_verifier: VERIFIER, redirect_uri: REDIRECT });
    expect(res.statusCode).toBe(503);
  });

  it('rejects a body missing the verifier', async () => {
    const res = await post({ code: 'x', redirect_uri: REDIRECT });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
  });

  it('rejects an oversized field', async () => {
    const code = 'a'.repeat(513);
    const res = await post({ code, code_verifier: VERIFIER, redirect_uri: REDIRECT });
    expect(res.json().error).toBe('invalid_request');
  });

  it('rejects an unknown code', async () => {
    const res = await post({ code: 'nope', code_verifier: VERIFIER, redirect_uri: REDIRECT });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_grant');
  });

  it('rejects a redirect URI the code was not bound to', async () => {
    const code = mintCode();
    const res = await post({ code, code_verifier: VERIFIER, redirect_uri: 'other://x' });
    expect(res.json().error).toBe('invalid_grant');
  });

  it('rejects a verifier that does not prove the challenge', async () => {
    const code = mintCode();
    const wrong = 'x'.repeat(43);
    const res = await post({ code, code_verifier: wrong, redirect_uri: REDIRECT });
    expect(res.json().error).toBe('invalid_grant');
  });

  it('rejects a code minted under different credentials', async () => {
    const code = mintCode({ fingerprint: 'stale-fingerprint' });
    const res = await post({ code, code_verifier: VERIFIER, redirect_uri: REDIRECT });
    expect(res.json().error).toBe('invalid_grant');
  });

  it('rejects factors that no longer satisfy the live auth mode', async () => {
    const code = mintCode();
    runtime.authMode = 'both';
    const res = await post({ code, code_verifier: VERIFIER, redirect_uri: REDIRECT });
    expect(res.json().error).toBe('invalid_grant');
  });

  it('exchanges a valid code for a token pair', async () => {
    const code = mintCode();
    const res = await post({ code, code_verifier: VERIFIER, redirect_uri: REDIRECT });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tokenType).toBe('Bearer');
    expect(body.expiresIn).toBe(900);
    expect(body.refreshToken.length).toBeGreaterThan(20);
    expect(body.sessionId.length).toBe(22);
  });

  it('mints an access token that only the access transport accepts', async () => {
    const code = mintCode();
    const res = await post({ code, code_verifier: VERIFIER, redirect_uri: REDIRECT });
    const accessToken = res.json().accessToken;
    const accepted = verifyToken(accessToken, runtime, 'access');
    const rejected = verifyToken(accessToken, runtime, 'cookie');
    expect(accepted.success).toBe(true);
    expect(rejected.success).toBe(false);
  });

  it('refuses a second exchange of the same code', async () => {
    const code = mintCode();
    await post({ code, code_verifier: VERIFIER, redirect_uri: REDIRECT });
    const res = await post({ code, code_verifier: VERIFIER, redirect_uri: REDIRECT });
    expect(res.json().error).toBe('invalid_grant');
  });

  it('revokes the tokens the first exchange handed out when a code is replayed', async () => {
    const code = mintCode();
    const first = await post({ code, code_verifier: VERIFIER, redirect_uri: REDIRECT });
    const refreshToken = first.json().refreshToken;
    await post({ code, code_verifier: VERIFIER, redirect_uri: REDIRECT });
    const found = tokens.findByToken(refreshToken);
    expect(found?.revokedAt).toBeGreaterThan(0);
  });
});
