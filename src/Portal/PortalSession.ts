/**
 * Stateless signed-cookie session for the portal. A session is an HMAC-signed
 * JSON token (`base64(payload).sig`) carrying which factors are satisfied and
 * an expiry. No server store needed; the signing key is the portal secret.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Auth factors completed by the current session. */
export interface ISessionPayload {
  email?: string;
  google: boolean;
  password: boolean;
  expires: number;
}

/**
 * Computes the HMAC-SHA256 signature for a payload string.
 * @param payload - base64 payload to sign.
 * @param secret - Portal session secret.
 * @returns Hex signature.
 */
function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Encodes a session payload into a signed cookie token.
 * @param data - Factors + email to embed (expiry is added automatically).
 * @param secret - Portal session secret.
 * @returns Signed `payload.sig` token string.
 */
export function createSession(data: Omit<ISessionPayload, 'expires'>, secret: string): string {
  const payload = { ...data, expires: Date.now() + SESSION_TTL_MS };
  const json = JSON.stringify(payload);
  const body = Buffer.from(json).toString('base64url');
  const signature = sign(body, secret);
  return `${body}.${signature}`;
}

/**
 * Verifies a session token and returns its payload when valid + unexpired.
 * @param token - The `payload.sig` cookie value.
 * @param secret - Portal session secret.
 * @returns Procedure with the payload, or failure when invalid/tampered/expired.
 */
export function readSession(token: string, secret: string): Procedure<ISessionPayload> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return fail('Malformed session token');
  const expected = sign(body, secret);
  const want = Buffer.from(expected);
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return fail('Bad signature');
  const decoded = Buffer.from(body, 'base64url').toString();
  const data = JSON.parse(decoded) as ISessionPayload;
  return data.expires > Date.now() ? succeed(data) : fail('Session expired');
}
