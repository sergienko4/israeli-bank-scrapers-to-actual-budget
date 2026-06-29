/**
 * Minimal Google OAuth 2.0 helper (no SDK — uses native fetch). Builds the
 * consent URL, exchanges the code for tokens, and reads the verified email
 * from the id_token. Email allow-listing is enforced by the caller.
 */

import type { IPortalGoogleConfig, Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';

const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Builds the Google consent URL for the configured client + redirect.
 * @param google - Portal Google config (clientId, redirectUri).
 * @param state - Opaque CSRF state echoed back to the callback.
 * @returns Fully-qualified consent URL.
 */
export function buildAuthUrl(google: IPortalGoogleConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: google.clientId, redirect_uri: google.redirectUri,
    response_type: 'code', scope: 'openid email', state,
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

/** Claims this helper consumes from a Google id_token payload. */
interface IIdTokenClaims {
  email: string;
  emailVerified: boolean;
}

/**
 * Decodes the email + email_verified claims from a Google id_token JWT. The
 * signature is not re-checked here (the token came straight from Google over
 * HTTPS); the caller additionally enforces the email allow-list.
 * @param idToken - Compact JWT returned by the token endpoint.
 * @returns The email claim and whether Google marked it verified.
 */
function claimsFromIdToken(idToken: string): IIdTokenClaims {
  const part = idToken.split('.')[1] ?? '';
  const json = Buffer.from(part, 'base64url').toString();
  const payload = JSON.parse(json) as {
    email?: string;
    email_verified?: boolean | string;
  };
  const verified = payload.email_verified;
  const isVerified = verified === true || verified === 'true';
  return { email: payload.email ?? '', emailVerified: isVerified };
}

/**
 * Exchanges an OAuth code for tokens and returns the verified email.
 * @param google - Portal Google config (clientId, clientSecret, redirectUri).
 * @param code - Authorization code from the consent redirect.
 * @returns Procedure with the email on success, or failure on error.
 */
export async function exchangeCode(
  google: IPortalGoogleConfig, code: string,
): Promise<Procedure<string>> {
  try {
    const body = new URLSearchParams({
      code, client_id: google.clientId, client_secret: google.clientSecret ?? '',
      redirect_uri: google.redirectUri, grant_type: 'authorization_code',
    });
    const res = await fetch(TOKEN_URL, { method: 'POST', body });
    if (!res.ok) return fail(`Google token exchange failed: ${String(res.status)}`);
    const data = (await res.json()) as { id_token?: string };
    const claims = claimsFromIdToken(data.id_token ?? '');
    if (!claims.emailVerified) return fail('Google did not verify the account email');
    return succeed(claims.email);
  } catch (error: unknown) {
    return fail(`Google OAuth error: ${errorMessage(error)}`);
  }
}
