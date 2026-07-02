/**
 * Minimal Google OAuth 2.0 helper (no SDK — uses native fetch). Builds the
 * consent URL, exchanges the code for tokens, and reads the verified email
 * from the id_token. Email allow-listing is enforced by the caller.
 */

import type { IPortalGoogleConfig, Procedure } from '../Types/Index.js';
import { fail, isSuccess, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';

const DEFAULT_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Hard deadline (ms) for the Google token-exchange request. */
const TOKEN_TIMEOUT_MS = 10_000;

/**
 * Resolves the Google authorization endpoint. The `GOOGLE_AUTH_BASE` env var
 * overrides it for self-hosted identity proxies and end-to-end tests; a blank or
 * whitespace-only value is treated as unset so Google's public consent URL is
 * used instead of a malformed base.
 * @returns The authorization base URL.
 */
export function resolveAuthBase(): string {
  const authBase = process.env.GOOGLE_AUTH_BASE?.trim();
  return authBase || DEFAULT_AUTH_BASE;
}

/**
 * Resolves the Google token endpoint. The `GOOGLE_TOKEN_URL` env var overrides
 * it for self-hosted identity proxies and end-to-end tests; a blank or
 * whitespace-only value is treated as unset so a `fetch('')` never happens.
 * @returns The token exchange URL.
 */
export function resolveTokenUrl(): string {
  const tokenUrl = process.env.GOOGLE_TOKEN_URL?.trim();
  return tokenUrl || DEFAULT_TOKEN_URL;
}

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
  return `${resolveAuthBase()}?${params.toString()}`;
}

/** Trusted Google id_token issuers (current + legacy spellings). */
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** Claims this helper consumes from a Google id_token payload. */
interface IIdTokenClaims {
  email: string;
  emailVerified: boolean;
}

/** Raw fields read from an id_token payload for verification + claims. */
interface IIdTokenPayload {
  iss?: string;
  aud?: string;
  exp?: number;
  email?: string;
  email_verified?: boolean | string;
}

/**
 * Base64url-decodes the id_token payload segment into its raw claims.
 * @param idToken - Compact JWT returned by the token endpoint.
 * @returns The decoded payload (fields are validated by the caller).
 */
function decodeIdToken(idToken: string): IIdTokenPayload {
  const part = idToken.split('.')[1] ?? '';
  const json = Buffer.from(part, 'base64url').toString();
  return JSON.parse(json) as IIdTokenPayload;
}

/**
 * Returns a human-readable reason when the id_token's issuer, audience, or
 * expiry cannot be trusted, or an empty string when every check passes. The JWT
 * signature is not re-checked (the token is fetched directly from Google's token
 * endpoint over TLS using our client secret), but Google requires validating
 * `iss` and `aud` even server-to-server: without the `aud` check a token minted
 * for another application could be replayed against this backend.
 * @param payload - Decoded id_token payload.
 * @param clientId - The portal's Google client id the token must be issued to.
 * @returns The validation error message, or '' when the token is trusted.
 */
function tokenTrustError(payload: IIdTokenPayload, clientId: string): string {
  if (!payload.iss || !GOOGLE_ISSUERS.has(payload.iss)) return 'untrusted id_token issuer';
  if (payload.aud !== clientId) return 'id_token audience mismatch';
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return 'id_token has expired';
  return '';
}

/**
 * Verifies then reads the email + email_verified claims from a Google id_token.
 * Issuer/audience/expiry are validated first (see {@link tokenTrustError}); the
 * caller additionally enforces the email allow-list.
 * @param idToken - Compact JWT returned by the token endpoint.
 * @param clientId - The portal's Google client id (the expected `aud`).
 * @returns Procedure with the email claims, or failure when the token is untrusted.
 */
function claimsFromIdToken(idToken: string, clientId: string): Procedure<IIdTokenClaims> {
  const payload = decodeIdToken(idToken);
  const trustError = tokenTrustError(payload, clientId);
  if (trustError) return fail(trustError);
  const verified = payload.email_verified;
  const isVerified = verified === true || verified === 'true';
  return succeed({ email: payload.email ?? '', emailVerified: isVerified });
}

/**
 * Sends the token-exchange POST with a hard timeout so a hung Google endpoint
 * aborts instead of holding the public login route open until the platform
 * gives up. An abort surfaces as a rejected fetch handled by {@link exchangeCode}.
 * @param body - URL-encoded token-exchange parameters.
 * @returns The token endpoint response (the caller inspects `res.ok`).
 */
function postToken(body: URLSearchParams): Promise<Response> {
  const tokenUrl = resolveTokenUrl();
  const signal = AbortSignal.timeout(TOKEN_TIMEOUT_MS);
  return fetch(tokenUrl, { method: 'POST', body, signal });
}

/**
 * Exchanges an OAuth code for tokens and returns the verified email.
 * @param google - Portal Google config (clientId, clientSecret, redirectUri).
 * @param code - Authorization code from the consent redirect.
 * @returns Procedure with the email on success, or failure on error (including
 * a token-endpoint timeout, surfaced through the catch path).
 */
export async function exchangeCode(
  google: IPortalGoogleConfig, code: string,
): Promise<Procedure<string>> {
  try {
    const body = new URLSearchParams({
      code, client_id: google.clientId, client_secret: google.clientSecret ?? '',
      redirect_uri: google.redirectUri, grant_type: 'authorization_code',
    });
    const res = await postToken(body);
    if (!res.ok) return fail(`Google token exchange failed: ${String(res.status)}`);
    const data = (await res.json()) as { id_token?: string };
    const claimsResult = claimsFromIdToken(data.id_token ?? '', google.clientId);
    if (!isSuccess(claimsResult)) return fail(claimsResult.message);
    const claims = claimsResult.data;
    if (!claims.emailVerified) return fail('Google did not verify the account email');
    return succeed(claims.email);
  } catch (error: unknown) {
    return fail(`Google OAuth error: ${errorMessage(error)}`);
  }
}
