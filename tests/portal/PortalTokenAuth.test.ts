import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { credentialFingerprint, type IPortalRuntime } from '../../src/Portal/PortalRuntime.js';
import { hashPassword } from '../../src/Portal/PortalPassword.js';
import { ACCESS_TTL_MS, createSession } from '../../src/Portal/PortalSession.js';
import { bearerSessionOf, verifyToken } from '../../src/Portal/PortalTokenAuth.js';
import { isFail } from '../../src/Types/Index.js';
import { fakePortalConfig, fakePortalRuntime } from '../helpers/portalFactories.js';

/**
 * Builds a request double carrying only the Authorization header the parser reads.
 * @param authorization - The Authorization header value, or undefined to omit it.
 * @returns A minimal FastifyRequest exposing the header.
 */
function reqWith(authorization?: string): FastifyRequest {
  const headers = authorization === undefined ? {} : { authorization };
  return { headers } as unknown as FastifyRequest;
}

/**
 * Signs a valid password-factor session token for a runtime.
 * @param rt - Runtime whose secret + credentials the token is bound to.
 * @returns A `payload.sig` token string.
 */
function tokenFor(rt: IPortalRuntime): string {
  const payload = {
    google: false,
    password: true,
    fingerprint: credentialFingerprint(rt),
    typ: 'access' as const,
  };
  return createSession(payload, rt.sessionSecret, ACCESS_TTL_MS);
}

describe('verifyToken', () => {
  it('accepts a token signed for the runtime', () => {
    const rt = fakePortalRuntime();
    const result = verifyToken(tokenFor(rt), rt);
    expect(result.success).toBe(true);
    if (!isFail(result)) expect(result.data.password).toBe(true);
  });

  it('rejects a garbage token', () => {
    expect(isFail(verifyToken('not.a.token', fakePortalRuntime()))).toBe(true);
  });

  it('rejects a token whose fingerprint no longer matches the credentials', () => {
    const rt = fakePortalRuntime();
    const token = tokenFor(rt);
    const rotated = fakePortalRuntime({
      portal: fakePortalConfig({ passwordHash: hashPassword('a-different-password') }),
    });
    const result = verifyToken(token, rotated);
    expect(isFail(result)).toBe(true);
    if (isFail(result)) expect(result.message).toBe('Credentials changed');
  });
});

describe('bearerSessionOf', () => {
  it('reads a valid Bearer token', () => {
    const rt = fakePortalRuntime();
    const result = bearerSessionOf(reqWith(`Bearer ${tokenFor(rt)}`), rt);
    expect(result.success).toBe(true);
  });

  it('accepts a lowercase bearer scheme', () => {
    const rt = fakePortalRuntime();
    const result = bearerSessionOf(reqWith(`bearer ${tokenFor(rt)}`), rt);
    expect(result.success).toBe(true);
  });

  it('fails when the Authorization header is absent', () => {
    const result = bearerSessionOf(reqWith(), fakePortalRuntime());
    expect(isFail(result)).toBe(true);
    if (isFail(result)) expect(result.message).toBe('No bearer token');
  });

  it('fails on the wrong Authorization scheme', () => {
    const rt = fakePortalRuntime();
    const result = bearerSessionOf(reqWith(`Token ${tokenFor(rt)}`), rt);
    expect(isFail(result)).toBe(true);
    if (isFail(result)) expect(result.message).toBe('No bearer token');
  });

  it('fails when the scheme carries no token', () => {
    const result = bearerSessionOf(reqWith('Bearer'), fakePortalRuntime());
    expect(isFail(result)).toBe(true);
  });

  it('fails on a well-formed header carrying a garbage token', () => {
    const result = bearerSessionOf(reqWith('Bearer not.a.token'), fakePortalRuntime());
    expect(isFail(result)).toBe(true);
  });
});
