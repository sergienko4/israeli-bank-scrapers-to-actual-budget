/**
 * Portal authentication routes: password login, Google OAuth start/callback,
 * logout, and an /api guard preHandler. Sessions accumulate factors so `both`
 * mode is satisfied only after Google AND password succeed.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Procedure } from '../Types/Index.js';
import { fail, isFail } from '../Types/Index.js';
import { isAuthorized } from './PortalAuthPolicy.js';
import { type IGrantArgs, registerGoogleRoutes } from './PortalGoogleRoutes.js';
import { verifyPassword } from './PortalPassword.js';
import type { IPortalRuntime } from './PortalRuntime.js';
import { createSession, type ISessionPayload, readSession } from './PortalSession.js';

const COOKIE = 'portal_session';

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
  reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/' });
  return { granted: true };
}

/**
 * Guards /api/* paths: denies unless the session satisfies the auth mode.
 * @param req - Request.
 * @param reply - Reply.
 * @param rt - Runtime.
 * @returns True when the request may proceed; sends 401 and returns false otherwise.
 */
function guardApi(req: FastifyRequest, reply: FastifyReply, rt: IPortalRuntime): boolean {
  if (!req.url.startsWith('/api/')) return true;
  const result = sessionOf(req, rt.sessionSecret);
  const isAllowed = isFail(result) ? false : isAuthorized(result.data, rt.authMode);
  if (!isAllowed) reply.code(401).send({ error: 'Unauthorized' });
  return isAllowed;
}

/**
 * Registers the password-login + logout + guard routes.
 * @param app - Fastify instance.
 * @param rt - Resolved portal runtime.
 * @returns Confirmation that the auth routes are registered.
 */
export function registerAuthRoutes(app: FastifyInstance, rt: IPortalRuntime): { registered: true } {
  app.post('/auth/login', (req, reply) => {
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
