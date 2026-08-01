/**
 * The app's token endpoint: it trades a one-time authorization code for a
 * short-lived access token and a rotating refresh token.
 *
 * Every check here is a re-check. The authorize endpoint already decided the
 * caller was allowed in, but that decision was made in a browser, minutes ago,
 * against credentials that may since have changed - so the code is only
 * honoured while it still matches the live configuration.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getLogger } from '../Logger/Index.js';
import { fail, isFail, isSuccess, type Procedure,succeed } from '../Types/Index.js';
import type { AppAuthCodes, IAuthCodeRecord } from './AppAuthCodes.js';
import type { AppTokenStore, IIssuedToken } from './AppTokenStore.js';
import { verifyChallenge } from './Pkce.js';
import { isAuthorized } from './PortalAuthPolicy.js';
import { LOGIN_MAX, RATE_WINDOW } from './PortalRateLimit.js';
import { APP_GRANT_SCHEMA } from './PortalRouteSchemas.js';
import {
  credentialFingerprint,
  type IPortalRuntime,
  type RuntimeAccessor,
} from './PortalRuntime.js';
import { createSession, type ISessionPayload } from './PortalSession.js';

/** Longest value accepted in any request field, well above every real one. */
const MAX_FIELD = 512;
/** Error body for a malformed request. */
export const INVALID_REQUEST = 'invalid_request';
/** Error body for anything the caller is not entitled to. */
export const INVALID_GRANT = 'invalid_grant';
/** Body returned whenever app sign-in is switched off. */
export const APP_UNCONFIGURED = 'App sign-in is not configured';
/** One minute, in milliseconds. */
export const MINUTE_MS = 60_000;
/** Seconds in a minute, for the `expiresIn` field. */
export const SECONDS_PER_MINUTE = 60;

/** Collaborators the token endpoint needs, injected to avoid an import cycle. */
export interface IAppTokenDeps {
  live: RuntimeAccessor;
  codes: AppAuthCodes;
  tokens: AppTokenStore;
}

/** The validated shape of a token request body. */
export interface ITokenRequest {
  code: string;
  verifier: string;
  redirectUri: string;
}

/** What a successful exchange hands back to the app. */
export interface IGrantedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  sessionId: string;
}

/**
 * Whether an untrusted body field is a string of a plausible length.
 * @param value - The raw field taken off the request body.
 * @returns True when the field can be used as-is.
 */
export function isField(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD;
}

/**
 * Validates the token request body without revealing which field was wrong.
 * @param body - The parsed JSON request body.
 * @returns Procedure with the request, or a failure naming `invalid_request`.
 */
export function parseTokenBody(body: unknown): Procedure<ITokenRequest> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const code = raw.code;
  const verifier = raw.code_verifier;
  const redirectUri = raw.redirect_uri;
  const isUsable = isField(code) && isField(verifier) && isField(redirectUri);
  if (!isUsable) return fail(INVALID_REQUEST);
  return succeed({ code, verifier, redirectUri });
}

/**
 * Rebuilds the session the code stands for, so the live auth mode can be
 * applied to it exactly as it would be to a browser session.
 * @param record - The redeemed authorization code.
 * @returns A session payload carrying the code's factors.
 */
function sessionOfCode(record: IAuthCodeRecord): ISessionPayload {
  return {
    email: record.email,
    google: record.factors.google,
    password: record.factors.password,
    expires: record.expiresAt,
    fingerprint: record.fingerprint,
    typ: 'access',
  };
}

/**
 * Re-checks a redeemed code against the request and the live configuration.
 * @param record - The redeemed authorization code.
 * @param request - The validated token request.
 * @param runtime - Live portal runtime.
 * @returns Procedure with the record, or a failure naming `invalid_grant`.
 */
function validateGrant(
  record: IAuthCodeRecord,
  request: ITokenRequest,
  runtime: IPortalRuntime,
): Procedure<IAuthCodeRecord> {
  if (record.redirectUri !== request.redirectUri) return fail(INVALID_GRANT);
  const isProven = verifyChallenge(request.verifier, record.challenge);
  if (!isProven) return fail(INVALID_GRANT);
  const live = credentialFingerprint(runtime);
  if (record.fingerprint !== live) return fail(INVALID_GRANT);
  const session = sessionOfCode(record);
  const isStillAllowed = isAuthorized(session, runtime.authMode);
  if (!isStillAllowed) return fail(INVALID_GRANT);
  return succeed(record);
}

/**
 * Revokes everything the first redemption of a replayed code handed out.
 *
 * A replay means the code reached someone it should not have, so the tokens it
 * bought are destroyed. That silently ends a device's access, which is worth a
 * line in the log; the code, the verifier and the tokens are not.
 * @param deps - Injected collaborators.
 * @param code - The code that was presented twice.
 * @returns How many refresh tokens were revoked.
 */
function revokeReplayedFamily(deps: IAppTokenDeps, code: string): number {
  const family = deps.codes.familyOf(code);
  if (!isSuccess(family)) return 0;
  const revoked = deps.tokens.revokeFamily(family.data);
  getLogger().warn(`Portal: app authorization code replayed; revoked ${String(revoked)} token(s)`);
  return revoked;
}

/**
 * Redeems the code and re-validates it, treating a replay as a breach.
 * @param deps - Injected collaborators.
 * @param request - The validated token request.
 * @param runtime - Live portal runtime.
 * @returns Procedure with the record, or a failure naming `invalid_grant`.
 */
function redeemCode(
  deps: IAppTokenDeps,
  request: ITokenRequest,
  runtime: IPortalRuntime,
): Procedure<IAuthCodeRecord> {
  const redeemed = deps.codes.redeem(request.code);
  if (isFail(redeemed)) {
    if (redeemed.status === 'reused') revokeReplayedFamily(deps, request.code);
    return fail(INVALID_GRANT);
  }
  return validateGrant(redeemed.data, request, runtime);
}

/**
 * Shapes the response body around a freshly issued token pair.
 * @param issued - The refresh token record and its one-time clear value.
 * @param accessToken - The signed access token.
 * @param minutes - Access token lifetime in minutes.
 * @returns The response body handed to the app.
 */
export function tokenResponse(
  issued: IIssuedToken,
  accessToken: string,
  minutes: number,
): IGrantedTokens {
  return {
    accessToken,
    refreshToken: issued.token,
    expiresIn: minutes * SECONDS_PER_MINUTE,
    tokenType: 'Bearer',
    sessionId: issued.record.id,
  };
}

/**
 * Issues the token pair for a validated code.
 * @param record - The redeemed authorization code.
 * @param deps - Injected collaborators.
 * @param runtime - Live portal runtime.
 * @returns The response body handed to the app.
 */
function issueTokens(
  record: IAuthCodeRecord,
  deps: IAppTokenDeps,
  runtime: IPortalRuntime,
): IGrantedTokens {
  const minutes = runtime.app.accessTokenTtlMinutes;
  const grant = {
    deviceName: record.deviceName,
    email: record.email,
    factors: record.factors,
    fingerprint: record.fingerprint,
  };
  const issued = deps.tokens.issue(grant);
  deps.codes.bindFamily(record.code, issued.record.familyId);
  const claims = { ...sessionOfCode(record), family: issued.record.familyId };
  const ttlMs = minutes * MINUTE_MS;
  const accessToken = createSession(claims, runtime.sessionSecret, ttlMs);
  return tokenResponse(issued, accessToken, minutes);
}

/**
 * Handles one token exchange.
 * @param req - Incoming request.
 * @param reply - Outgoing reply.
 * @param deps - Injected collaborators.
 * @returns The reply, already sent.
 */
function handleToken(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: IAppTokenDeps,
): FastifyReply {
  const runtime = deps.live();
  if (!runtime.app.enabled) return reply.code(503).send({ error: APP_UNCONFIGURED });
  const parsed = parseTokenBody(req.body);
  if (isFail(parsed)) return reply.code(400).send({ error: INVALID_REQUEST });
  const granted = redeemCode(deps, parsed.data, runtime);
  if (isFail(granted)) return reply.code(400).send({ error: INVALID_GRANT });
  const tokens = issueTokens(granted.data, deps, runtime);
  return reply.code(200).send(tokens);
}

/**
 * Registers the app token endpoint.
 * @param app - Fastify instance to register on.
 * @param deps - Injected collaborators.
 * @returns A marker object so callers can assert registration happened.
 */
export function registerAppTokenRoutes(
  app: FastifyInstance,
  deps: IAppTokenDeps,
): { registered: true } {
  const options = {
    config: { rateLimit: { max: LOGIN_MAX, timeWindow: RATE_WINDOW } },
    schema: APP_GRANT_SCHEMA,
  };
  app.post('/auth/app/token', options, (req, reply) => handleToken(req, reply, deps));
  return { registered: true };
}
