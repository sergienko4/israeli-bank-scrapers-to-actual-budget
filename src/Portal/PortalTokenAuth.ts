/**
 * Bearer-token auth for native/API clients. Reuses the portal's stateless
 * signed-session format, but an access token and a cookie session are minted
 * with different `typ` claims, so this module refuses a cookie value replayed
 * in an `Authorization` header. Because the token embeds the credential
 * fingerprint, a password rotation evicts bearer tokens exactly as it evicts
 * cookie sessions.
 */

import type { FastifyRequest } from 'fastify';

import type { Procedure } from '../Types/Index.js';
import { fail, isFail } from '../Types/Index.js';
import { credentialFingerprint, type IPortalRuntime } from './PortalRuntime.js';
import { type ISessionPayload, readSession, type SessionType } from './PortalSession.js';

const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * Verifies a raw signed-session token against the live runtime: valid signature,
 * unexpired, minted for the transport it arrived on, and a credential
 * fingerprint that still matches the current password/allow-list — so a rotated
 * credential evicts the token.
 * @param raw - The `payload.sig` token string (from a cookie or bearer header).
 * @param rt - Live runtime carrying the session secret + current credentials.
 * @param expected - Transport the caller presented the token on.
 * @returns Procedure with the session payload, or failure when invalid/mismatched/stale.
 */
export function verifyToken(
  raw: string, rt: IPortalRuntime, expected: SessionType,
): Procedure<ISessionPayload> {
  const result = readSession(raw, rt.sessionSecret);
  if (isFail(result)) return result;
  if (result.data.typ !== expected) return fail('Wrong token type');
  return result.data.fingerprint === credentialFingerprint(rt)
    ? result
    : fail('Credentials changed');
}

/**
 * Reads and verifies a bearer-token session from a request's `Authorization`
 * header. The scheme match is case-insensitive and the token must be a single
 * non-whitespace run, so a missing or malformed header yields a failure rather
 * than a partial value the verifier would then reject.
 * @param req - Incoming request.
 * @param rt - Live runtime carrying the session secret + current credentials.
 * @returns Procedure with the session payload, or failure when absent/invalid/stale.
 */
export function bearerSessionOf(
  req: FastifyRequest, rt: IPortalRuntime,
): Procedure<ISessionPayload> {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return fail('No bearer token');
  const trimmed = header.trim();
  const match = BEARER.exec(trimmed);
  if (!match) return fail('No bearer token');
  return verifyToken(match[1], rt, 'access');
}
