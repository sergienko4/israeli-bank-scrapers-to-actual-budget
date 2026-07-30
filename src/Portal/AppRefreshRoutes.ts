/**
 * The app's refresh and revoke endpoints.
 *
 * A refresh token is single-use: presenting one always replaces it. That makes
 * a second presentation of the same token evidence that a copy exists, and the
 * whole family it belongs to is destroyed rather than guessing which holder
 * was the real app.
 *
 * Revocation answers the same way whether or not the token existed, so the
 * endpoint cannot be used to test tokens.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { fail, isFail, type Procedure, succeed } from '../Types/Index.js';
import {
  APP_UNCONFIGURED,
  type IGrantedTokens,
  INVALID_GRANT,
  INVALID_REQUEST,
  isField,
  MINUTE_MS,
  tokenResponse,
} from './AppTokenRoutes.js';
import type { AppTokenStore, IAppTokenRecord, IIssuedToken } from './AppTokenStore.js';
import { isAuthorized } from './PortalAuthPolicy.js';
import { LOGIN_MAX, RATE_WINDOW, REFRESH_MAX } from './PortalRateLimit.js';
import {
  credentialFingerprint,
  type IPortalRuntime,
  type RuntimeAccessor,
} from './PortalRuntime.js';
import { createSession, type ISessionPayload } from './PortalSession.js';

/** Collaborators the refresh endpoints need, injected to avoid an import cycle. */
export interface IAppRefreshDeps {
  live: RuntimeAccessor;
  tokens: AppTokenStore;
}

/**
 * Reads the refresh token out of an untrusted request body.
 * @param body - The parsed JSON request body.
 * @returns Procedure with the token, or a failure naming `invalid_request`.
 */
export function parseRefreshBody(body: unknown): Procedure<string> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const token = raw.refreshToken;
  if (!isField(token)) return fail(INVALID_REQUEST);
  return succeed(token);
}

/**
 * Rebuilds the session a refresh token stands for, so the live auth mode can
 * be applied to it exactly as it would be to a browser session.
 * @param record - The refresh token record.
 * @param expires - When the access token minted from it will expire.
 * @returns A session payload carrying the record's factors.
 */
function sessionOfRecord(record: IAppTokenRecord, expires: number): ISessionPayload {
  return {
    email: record.email,
    google: record.factors.google,
    password: record.factors.password,
    expires,
    fingerprint: record.fingerprint,
    typ: 'access',
    family: record.familyId,
  };
}

/**
 * Re-checks a rotated record against the live configuration, destroying the
 * family when it no longer earns the access it was originally granted.
 * @param issued - The freshly rotated token pair.
 * @param deps - Injected collaborators.
 * @param runtime - Live portal runtime.
 * @returns Procedure with the pair, or a failure naming `invalid_grant`.
 */
function validateRotation(
  issued: IIssuedToken,
  deps: IAppRefreshDeps,
  runtime: IPortalRuntime,
): Procedure<IIssuedToken> {
  const { record } = issued;
  const session = sessionOfRecord(record, record.expiresAt);
  const isDrifted = record.fingerprint !== credentialFingerprint(runtime);
  const isStillAllowed = isAuthorized(session, runtime.authMode);
  if (!isDrifted && isStillAllowed) return succeed(issued);
  deps.tokens.revokeFamily(record.familyId);
  return fail(INVALID_GRANT);
}

/**
 * Rotates a refresh token and mints the access token that goes with it.
 * @param token - The refresh token presented by the app.
 * @param deps - Injected collaborators.
 * @param runtime - Live portal runtime.
 * @returns Procedure with the response body, or a failure naming `invalid_grant`.
 */
export function rotateTokens(
  token: string,
  deps: IAppRefreshDeps,
  runtime: IPortalRuntime,
): Procedure<IGrantedTokens> {
  const rotated = deps.tokens.rotate(token);
  if (isFail(rotated)) return fail(INVALID_GRANT);
  const checked = validateRotation(rotated.data, deps, runtime);
  if (isFail(checked)) return checked;
  const minutes = runtime.app.accessTokenTtlMinutes;
  const ttlMs = minutes * MINUTE_MS;
  const claims = sessionOfRecord(checked.data.record, Date.now() + ttlMs);
  const accessToken = createSession(claims, runtime.sessionSecret, ttlMs);
  const body = tokenResponse(checked.data, accessToken, minutes);
  return succeed(body);
}

/**
 * Handles one refresh exchange.
 * @param req - Incoming request.
 * @param reply - Outgoing reply.
 * @param deps - Injected collaborators.
 * @returns The reply, already sent.
 */
function handleRefresh(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: IAppRefreshDeps,
): FastifyReply {
  const runtime = deps.live();
  if (!runtime.app.enabled) return reply.code(503).send({ error: APP_UNCONFIGURED });
  const parsed = parseRefreshBody(req.body);
  if (isFail(parsed)) return reply.code(400).send({ error: INVALID_REQUEST });
  const granted = rotateTokens(parsed.data, deps, runtime);
  if (isFail(granted)) return reply.code(400).send({ error: INVALID_GRANT });
  const body = granted.data;
  return reply.code(200).send({
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    expiresIn: body.expiresIn,
    tokenType: body.tokenType,
    sessionId: body.sessionId,
  });
}

/**
 * Handles one revocation, which never reports whether the token was real.
 * @param req - Incoming request.
 * @param reply - Outgoing reply.
 * @param deps - Injected collaborators.
 * @returns The reply, already sent.
 */
function handleRevoke(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: IAppRefreshDeps,
): FastifyReply {
  const parsed = parseRefreshBody(req.body);
  if (!isFail(parsed)) {
    const record = deps.tokens.findByToken(parsed.data);
    if (record) deps.tokens.revokeFamily(record.familyId);
  }
  return reply.code(200).send({ ok: true });
}

/**
 * Registers the app refresh and revoke endpoints.
 * @param app - Fastify instance to register on.
 * @param deps - Injected collaborators.
 * @returns A marker confirming registration ran.
 */
export function registerAppRefreshRoutes(
  app: FastifyInstance,
  deps: IAppRefreshDeps,
): { registered: true } {
  const refresh = { config: { rateLimit: { max: REFRESH_MAX, timeWindow: RATE_WINDOW } } };
  const revoke = { config: { rateLimit: { max: LOGIN_MAX, timeWindow: RATE_WINDOW } } };
  app.post('/auth/app/refresh', refresh, (req, reply) => handleRefresh(req, reply, deps));
  app.post('/auth/app/revoke', revoke, (req, reply) => handleRevoke(req, reply, deps));
  return { registered: true };
}
