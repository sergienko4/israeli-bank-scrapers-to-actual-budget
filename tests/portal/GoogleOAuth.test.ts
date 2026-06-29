import { afterEach, describe, expect, it, vi } from 'vitest';

import { isFail, isSuccess } from '../../src/Types/Index.js';
import { buildAuthUrl, exchangeCode } from '../../src/Portal/GoogleOAuth.js';
import { fakeGoogleConfig } from '../helpers/portalFactories.js';

/**
 * Builds a fake Google id_token JWT carrying the given email claim.
 * @param email - Email claim to embed in the payload.
 * @returns Compact `header.payload.sig` token string.
 */
function jwtWithEmail(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email })).toString('base64url');
  return `header.${payload}.signature`;
}

describe('GoogleOAuth', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

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

    it('returns an empty email when the id_token has no email claim', async () => {
      const payload = Buffer.from(JSON.stringify({ sub: '123' })).toString('base64url');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, json: () => Promise.resolve({ id_token: `h.${payload}.s` }),
      }));
      const result = await exchangeCode(fakeGoogleConfig(), 'auth-code');
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) expect(result.data).toBe('');
    });

    it('fails when fetch throws', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
      const result = await exchangeCode(fakeGoogleConfig(), 'code');
      expect(isFail(result)).toBe(true);
      if (isFail(result)) expect(result.message).toMatch(/network down/);
    });
  });
});
