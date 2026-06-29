import { afterEach, describe, expect, it, vi } from 'vitest';

import { isFail, isSuccess } from '../../src/Types/Index.js';
import {
  buildAuthUrl, exchangeCode, resolveAuthBase, resolveTokenUrl,
} from '../../src/Portal/GoogleOAuth.js';
import { fakeGoogleConfig } from '../helpers/portalFactories.js';

/**
 * Builds a fake Google id_token JWT carrying the given email + verified flag.
 * @param email - Email claim to embed in the payload.
 * @param verified - Whether Google marked the email verified (default true).
 * @returns Compact `header.payload.sig` token string.
 */
function jwtWithEmail(email: string, verified: boolean | string = true): string {
  const claims = { email, email_verified: verified };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `header.${payload}.signature`;
}

describe('GoogleOAuth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GOOGLE_AUTH_BASE;
    delete process.env.GOOGLE_TOKEN_URL;
  });

  describe('endpoint overrides', () => {
    it('defaults to Google endpoints when no env override is set', () => {
      expect(resolveAuthBase()).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(resolveTokenUrl()).toBe('https://oauth2.googleapis.com/token');
    });

    it('honours GOOGLE_AUTH_BASE / GOOGLE_TOKEN_URL overrides', () => {
      process.env.GOOGLE_AUTH_BASE = 'http://127.0.0.1:9/auth';
      process.env.GOOGLE_TOKEN_URL = 'http://127.0.0.1:9/token';
      expect(resolveAuthBase()).toBe('http://127.0.0.1:9/auth');
      expect(resolveTokenUrl()).toBe('http://127.0.0.1:9/token');
    });

    it('builds the consent URL against the overridden auth base', () => {
      process.env.GOOGLE_AUTH_BASE = 'http://127.0.0.1:9/auth';
      const url = new URL(buildAuthUrl(fakeGoogleConfig(), 'state-xyz'));
      expect(url.origin + url.pathname).toBe('http://127.0.0.1:9/auth');
      expect(url.searchParams.get('state')).toBe('state-xyz');
    });

    it('exchanges the code against the overridden token endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true, status: 200, json: () => Promise.resolve({ id_token: jwtWithEmail('a@b.com') }),
      });
      vi.stubGlobal('fetch', fetchMock);
      process.env.GOOGLE_TOKEN_URL = 'http://127.0.0.1:9/token';
      await exchangeCode(fakeGoogleConfig(), 'auth-code');
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9/token', expect.anything());
    });
  });

  describe('buildAuthUrl', () => {
    it('embeds client_id, redirect_uri and state', () => {
      const url = new URL(buildAuthUrl(fakeGoogleConfig(), 'state-xyz'));
      expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url.searchParams.get('client_id')).toBe('client-123.apps.googleusercontent.com');
      expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8080/auth/google/callback');
      expect(url.searchParams.get('state')).toBe('state-xyz');
      expect(url.searchParams.get('scope')).toBe('openid email');
    });
  });

  describe('exchangeCode', () => {
    it('returns the verified email on success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, json: () => Promise.resolve({ id_token: jwtWithEmail('allowed@example.com') }),
      }));
      const result = await exchangeCode(fakeGoogleConfig(), 'auth-code');
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) expect(result.data).toBe('allowed@example.com');
    });

    it('tolerates a missing clientSecret', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, json: () => Promise.resolve({ id_token: jwtWithEmail('a@b.com') }),
      }));
      const result = await exchangeCode(fakeGoogleConfig({ clientSecret: undefined }), 'auth-code');
      expect(isSuccess(result)).toBe(true);
    });

    it('fails when the token endpoint returns non-ok', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve({}) }));
      const result = await exchangeCode(fakeGoogleConfig(), 'bad-code');
      expect(isFail(result)).toBe(true);
      if (isFail(result)) expect(result.message).toMatch(/400/);
    });

    it('fails when the id_token email is not verified', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ id_token: jwtWithEmail('spoof@example.com', false) }),
      }));
      const result = await exchangeCode(fakeGoogleConfig(), 'auth-code');
      expect(isFail(result)).toBe(true);
      if (isFail(result)) expect(result.message).toMatch(/verif/i);
    });

    it('fails when fetch throws', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
      const result = await exchangeCode(fakeGoogleConfig(), 'code');
      expect(isFail(result)).toBe(true);
      if (isFail(result)) expect(result.message).toMatch(/network down/);
    });

    it('fails when the response carries no id_token', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, json: () => Promise.resolve({}),
      }));
      const result = await exchangeCode(fakeGoogleConfig(), 'auth-code');
      expect(isFail(result)).toBe(true);
    });

    it('accepts a string "true" email_verified claim', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ id_token: jwtWithEmail('str@example.com', 'true') }),
      }));
      const result = await exchangeCode(fakeGoogleConfig(), 'auth-code');
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) expect(result.data).toBe('str@example.com');
    });
  });
});
