/**
 * Portal authentication routes: password login, Google OAuth start/callback,
 * logout, and an /api guard preHandler. Sessions accumulate factors so `both`
 * mode is satisfied only after Google AND password succeed.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { PortalAuthMode, Procedure } from '../Types/Index.js';
import { fail, isFail } from '../Types/Index.js';
import { isAuthorized } from './PortalAuthPolicy.js';
import { type IGrantArgs, registerGoogleRoutes } from './PortalGoogleRoutes.js';
import { verifyPassword } from './PortalPassword.js';
import { LOGIN_RATE_LIMIT, STATUS_RATE_LIMIT } from './PortalRateLimit.js';
import { type IPortalRuntime, portalCookieOptions } from './PortalRuntime.js';
import { createSession, type ISessionPayload, readSession } from './PortalSession.js';

const COOKIE = 'portal_session';

/** Public auth status for the login UI: configured mode + satisfied factors. */
export interface IAuthStatus {
  authMode: PortalAuthMode;
  google: boolean;
  password: boolean;
  email: string | null;
  authorized: boolean;
}

/**
 * Reads and verifies the session cookie from a request.
 * @param req - Incoming request.
 * @param secret - Session signing secret.
 * @returns Procedure with the session payload, or failure when absent/invalid.
 */
export function sessionOf(req: FastifyRequest, secret: string): Procedure<ISessionPayload> {
  const raw = req.cookies[COOKIE];
  return raw ? readSession(raw, secret) : fail('No session cookie');
}

/**
 * Writes a session cookie, merging the new factor onto any existing one.
 * @param args - Request, reply, runtime, and partial factor flags to merge.
 * @returns Confirmation that the cookie was granted.
 */
function grant(args: IGrantArgs): { granted: true } {
  const { req, reply, rt: runtime, factor } = args;
  const prior = sessionOf(req, runtime.sessionSecret);
  const base = isFail(prior) ? { google: false, password: false } : prior.data;
  const token = createSession({ ...base, ...factor }, runtime.sessionSecret);
  const cookieOpts = portalCookieOptions(runtime);
  reply.setCookie(COOKIE, token, cookieOpts);
  return { granted: true };
}

/**
 * Whether the request matched a protected `/api/*` route. Decided from the
 * router's matched route template, not the raw URL, so a percent-encoded path
 * like `/%61pi/config` — which Fastify decodes to `/api/config` before route
 * matching — cannot slip past a raw-prefix check and reach a handler unguarded.
 * @param req - Incoming request (this global preHandler runs after routing).
 * @returns True when the matched route path is under `/api/`.
 */
function isApiRoute(req: FastifyRequest): boolean {
  return (req.routeOptions.url ?? '').startsWith('/api/');
}

/**
 * Guards /api/* paths: denies unless the session satisfies the auth mode.
 * @param req - Request.
 * @param reply - Reply.
 * @param rt - Runtime.
 * @returns True when the request may proceed; sends 401 and returns false otherwise.
 */
function guardApi(req: FastifyRequest, reply: FastifyReply, rt: IPortalRuntime): boolean {
  if (!isApiRoute(req)) return true;
  const result = sessionOf(req, rt.sessionSecret);
  const isAllowed = isFail(result) ? false : isAuthorized(result.data, rt.authMode);
  if (!isAllowed) reply.code(401).send({ error: 'Unauthorized' });
  return isAllowed;
}

/**
 * Reports the configured auth mode plus which factors the caller's current
 * session already satisfies, so the login UI can show the right next step and
 * acknowledge a completed factor (e.g. Google done, password still pending in
 * `both` mode) instead of re-showing an identical login form.
 * @param req - Incoming request (carries the session cookie).
 * @param rt - Resolved portal runtime.
 * @returns Auth mode, per-factor flags, email, and overall authorization.
 */
function authStatus(req: FastifyRequest, rt: IPortalRuntime): IAuthStatus {
  const result = sessionOf(req, rt.sessionSecret);
  const session = isFail(result) ? null : result.data;
  return {
    authMode: rt.authMode,
    google: session?.google ?? false,
    password: session?.password ?? false,
    email: session?.email ?? null,
    authorized: session ? isAuthorized(session, rt.authMode) : false,
  };
}

/**
 * Registers the password-login + logout + guard routes.
 * @param app - Fastify instance.
 * @param rt - Resolved portal runtime.
 * @returns Confirmation that the auth routes are registered.
 */
export function registerAuthRoutes(app: FastifyInstance, rt: IPortalRuntime): { registered: true } {
  app.get('/auth/status', STATUS_RATE_LIMIT, (req, reply) => {
    const status = authStatus(req, rt);
    return reply.send(status);
  });
  app.post('/auth/login', LOGIN_RATE_LIMIT, (req, reply) => {
    const { password } = req.body as { password?: string };
    const hash = rt.portal.passwordHash ?? '';
    if (!password || !hash || !verifyPassword(password, hash)) {
      return reply.code(401).send({ error: 'Invalid password' });
    }
    grant({ req, reply, rt, factor: { password: true } });
    return reply.send({ ok: true });
  });
  app.post('/auth/logout', (_req, reply) => reply.clearCookie(COOKIE, { path: '/' }).send({ ok: true }));
  registerGoogleRoutes(app, rt, grant);
  app.addHook('preHandler', (req, reply, done) => { if (guardApi(req, reply, rt)) done(); });
  return { registered: true };
}
