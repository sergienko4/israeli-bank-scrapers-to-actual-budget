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
 * Narrows untrusted parsed JSON to a well-formed session payload.
 *
 * The cookie body is attacker-controllable, so a tampered or truncated payload
 * that still carries a valid signature must be rejected before the `/api/*`
 * guard trusts it as a logged-in session.
 * @param value - Parsed JSON of unknown shape from the cookie body.
 * @returns True when the value carries boolean factor flags, a numeric expiry, and a string/absent email.
 */
function isSessionPayload(value: unknown): value is ISessionPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.expires === 'number'
    && typeof payload.google === 'boolean'
    && typeof payload.password === 'boolean'
    && (payload.email === undefined || typeof payload.email === 'string');
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
  try {
    const decoded = Buffer.from(body, 'base64url').toString();
    const parsed = JSON.parse(decoded) as unknown;
    if (!isSessionPayload(parsed)) return fail('Malformed session payload');
    return parsed.expires > Date.now() ? succeed(parsed) : fail('Session expired');
  } catch {
    // Untrusted cookie: a bad base64/JSON body yields "no session", never a throw.
    return fail('Malformed session payload');
  }
}
