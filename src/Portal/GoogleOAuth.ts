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

/**
 * Decodes the email claim from a Google id_token JWT (payload is unverified
 * here; transport is HTTPS to Google, allow-list enforced separately).
 * @param idToken - Compact JWT returned by the token endpoint.
 * @returns The email claim, or empty string when absent.
 */
function emailFromIdToken(idToken: string): string {
  const part = idToken.split('.')[1] ?? '';
  const json = Buffer.from(part, 'base64url').toString();
  return (JSON.parse(json) as { email?: string }).email ?? '';
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
    const email = emailFromIdToken(data.id_token ?? '');
    return succeed(email);
  } catch (error: unknown) {
    return fail(`Google OAuth error: ${errorMessage(error)}`);
  }
}
