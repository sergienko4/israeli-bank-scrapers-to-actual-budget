/**
 * The phone's half of app sign-in, as a reusable client.
 *
 * Both the in-process and the Dockerized end-to-end tests drive the portal
 * through exactly this code, so "it works in a container" means the same client
 * that passed in-process, not a second implementation that might disagree.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { BrowserContext } from 'playwright-core';
import { expect } from 'vitest';

/** The only redirect target the seeded portals accept. */
export const REDIRECT_URI = 'bankimporter://auth';

/** How the app names itself when it asks for a code. */
export const DEVICE_NAME = 'Pixel 8';

/** A PKCE verifier and the S256 challenge derived from it. */
export interface IPkcePair {
  verifier: string;
  challenge: string;
}

/** What one completed app sign-in hands back to the phone. */
export interface IIssuedPair {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

/** A JSON response reduced to what these tests assert on. */
export interface IJsonReply {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Derives a PKCE pair the same way RFC 7636 says to, independently of the
 * portal's own implementation, so a bug in `Pkce.ts` cannot hide here.
 * @returns A fresh verifier and its S256 challenge.
 */
export function pkcePair(): IPkcePair {
  const verifier = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(verifier).digest();
  return { verifier, challenge: digest.toString('base64url') };
}

/**
 * Builds an authorize URL exactly as the app would.
 * @param base - Portal base URL.
 * @param challenge - PKCE challenge.
 * @param state - Opaque value the app expects back untouched.
 * @param redirectUri - Where the portal should send the code.
 * @returns The full authorize URL.
 */
export function authorizeUrl(
  base: string,
  challenge: string,
  state: string,
  redirectUri: string = REDIRECT_URI,
): string {
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    device_name: DEVICE_NAME,
  });
  return `${base}/auth/app/authorize?${params.toString()}`;
}

/**
 * Serializes the browser's cookies for the portal into a request header.
 * @param context - Browser context holding the session cookie.
 * @param base - Portal base URL.
 * @returns A `Cookie` header value.
 */
export async function cookieHeader(context: BrowserContext, base: string): Promise<string> {
  const cookies = await context.cookies(base);
  const pairs = cookies.map((cookie) => `${cookie.name}=${cookie.value}`);
  return pairs.join('; ');
}

/**
 * Requests an authorization code with the signed-in browser's cookies, without
 * following the redirect into the app's custom scheme.
 * @param url - Authorize URL to request.
 * @param cookie - The browser's `Cookie` header value.
 * @returns The unfollowed response.
 */
export async function authorizeWithCookie(url: string, cookie: string): Promise<Response> {
  return await fetch(url, { headers: { cookie }, redirect: 'manual' });
}

/**
 * Reads the code and state the portal handed back on the redirect.
 * @param location - The `Location` header value.
 * @returns The parsed code and state, blank when absent.
 */
export function codeFrom(location: string): { code: string; state: string } {
  const target = new URL(location);
  return {
    code: target.searchParams.get('code') ?? '',
    state: target.searchParams.get('state') ?? '',
  };
}

/**
 * Posts JSON with no cookies at all, the way the app's HTTP client does.
 * @param url - Absolute URL to post to.
 * @param body - JSON body.
 * @param headers - Extra headers, used to name the caller behind a proxy.
 * @returns The status code and parsed body.
 */
export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<IJsonReply> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body: parsed };
}

/**
 * Exchanges an authorization code for a token pair.
 * @param base - Portal base URL.
 * @param code - The authorization code.
 * @param verifier - The PKCE verifier that matches the code's challenge.
 * @param redirectUri - The redirect URI the code was issued for.
 * @returns The status code and parsed body.
 */
export async function exchange(
  base: string,
  code: string,
  verifier: string,
  redirectUri: string = REDIRECT_URI,
): Promise<IJsonReply> {
  return await postJson(`${base}/auth/app/token`, {
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
}

/**
 * Calls a guarded endpoint with an app access token and nothing else.
 * @param base - Portal base URL.
 * @param path - Path under `/api`.
 * @param accessToken - The bearer token to present.
 * @returns The raw response.
 */
export async function callApi(base: string, path: string, accessToken: string): Promise<Response> {
  return await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

/**
 * Ends one app session by its listed id, the way the portal's own UI does.
 * @param base - Portal base URL.
 * @param sessionId - The session id from the sessions list.
 * @param accessToken - The bearer token of the caller doing the ending.
 * @returns The raw response.
 */
export async function deleteSession(
  base: string,
  sessionId: string,
  accessToken: string,
): Promise<Response> {
  return await fetch(`${base}/api/app/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

/**
 * Runs one full app sign-in on behalf of an already signed-in browser.
 * @param base - Portal base URL.
 * @param cookie - The browser's `Cookie` header value.
 * @param state - The state value to round-trip.
 * @returns The access token, refresh token and session id.
 */
export async function signInWithCookie(
  base: string,
  cookie: string,
  state: string,
): Promise<IIssuedPair> {
  const { verifier, challenge } = pkcePair();
  const url = authorizeUrl(base, challenge, state);
  const granted = await authorizeWithCookie(url, cookie);
  expect(granted.status).toBe(302);
  const location = granted.headers.get('location') ?? '';
  const handed = codeFrom(location);
  const issued = await exchange(base, handed.code, verifier);
  expect(issued.status).toBe(200);
  return {
    accessToken: String(issued.body.accessToken),
    refreshToken: String(issued.body.refreshToken),
    sessionId: String(issued.body.sessionId),
  };
}
