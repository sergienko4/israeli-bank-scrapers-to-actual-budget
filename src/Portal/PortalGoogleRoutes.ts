/**
 * Google OAuth routes for the portal, split out to keep the auth-route file
 * under its line cap. /auth/google starts consent; the callback verifies the
 * email against the allow-list before granting the `google` factor.
 */

import { randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { IPortalGoogleConfig, Procedure } from '../Types/Index.js';
import { fail, isFail, succeed } from '../Types/Index.js';
import { buildAuthUrl, exchangeCode } from './GoogleOAuth.js';
import { isEmailAllowed } from './PortalAuthPolicy.js';
import { OAUTH_MAX, RATE_WINDOW } from './PortalRateLimit.js';
import {
type IPortalRuntime,   isGoogleConfigComplete, portalCookieOptions, type RuntimeAccessor,
} from './PortalRuntime.js';
import type { ISessionPayload } from './PortalSession.js';

const STATE_COOKIE = 'portal_oauth_state';
const STATE_MAX_AGE = 600;
const GOOGLE_UNCONFIGURED = 'Google sign-in is not configured';

/** Factor-granting callback inputs supplied by the auth-routes module. */
export interface IGrantArgs {
  req: FastifyRequest;
  reply: FastifyReply;
  rt: IPortalRuntime;
  factor: Partial<ISessionPayload>;
}

/** Merges a verified factor into the session cookie; reports completion. */
export type GrantFn = (args: IGrantArgs) => { granted: true };

/** Live-runtime accessor plus the factor-granting callback. */
interface IGoogleRouteCtx {
  live: RuntimeAccessor;
  grant: GrantFn;
}

/** Live runtime + verified Google config resolved for a single request. */
interface IResolvedGoogle {
  rt: IPortalRuntime;
  google: IPortalGoogleConfig;
}

/**
 * Resolves the live runtime + Google config for a request. Reading the config
 * live means a Google client saved via the UI takes effect on the next request
 * without a restart, and a portal that booted without Google can still enable it
 * later. Callers map the failure to a 503 so the flow fails cleanly.
 * @param ctx - Live-runtime accessor and grant callback.
 * @returns The runtime + verified Google config, or a failure when unconfigured.
 */
function resolveGoogle(ctx: IGoogleRouteCtx): Procedure<IResolvedGoogle> {
  const rt = ctx.live();
  const google = rt.portal.google;
  if (isGoogleConfigComplete(google)) return succeed({ rt, google });
  return fail(GOOGLE_UNCONFIGURED);
}

/**
 * Registers the consent-start route that redirects to Google's OAuth screen.
 * @param app - Fastify instance.
 * @param ctx - Live-runtime accessor and grant callback.
 * @returns Confirmation that the consent route is registered.
 */
function registerConsentRoute(app: FastifyInstance, ctx: IGoogleRouteCtx): { registered: true } {
  const oauthLimit = { config: { rateLimit: { max: OAUTH_MAX, timeWindow: RATE_WINDOW } } };
  app.get('/auth/google', oauthLimit, (_req, reply) => {
    const resolved = resolveGoogle(ctx);
    if (isFail(resolved)) return reply.code(503).send({ error: GOOGLE_UNCONFIGURED });
    const { google } = resolved.data;
    const state = randomBytes(16).toString('hex');
    const cookieOpts = portalCookieOptions(resolved.data.rt, STATE_MAX_AGE);
    reply.setCookie(STATE_COOKIE, state, cookieOpts);
    const url = buildAuthUrl(google, state);
    return reply.redirect(url);
  });
  return { registered: true };
}

/** Request, reply, and verified authorization code for a Google callback. */
interface ICallbackArgs {
  req: FastifyRequest;
  reply: FastifyReply;
  code: string;
}

/**
 * Verifies the exchanged email against the allow-list and grants the factor.
 * @param resolved - Live runtime + verified Google config for this request.
 * @param ctx - Live-runtime accessor and grant callback.
 * @param args - The callback request, reply, and exchanged email.
 * @returns The Fastify reply outcome.
 */
async function finishCallback(
  resolved: IResolvedGoogle, ctx: IGoogleRouteCtx, args: ICallbackArgs,
): Promise<FastifyReply> {
  const { req, reply, code } = args;
  const email = await exchangeCode(resolved.google, code);
  if (isFail(email)) return await reply.code(502).send({ error: 'Google sign-in failed' });
  if (!isEmailAllowed(email.data, resolved.google.allowedEmails ?? [])) {
    return await reply.code(403).send({ error: 'Email not allowed' });
  }
  ctx.grant({ req, reply, rt: resolved.rt, factor: { google: true, email: email.data } });
  return await reply.redirect('/');
}

/**
 * Handles the Google OAuth callback: resolves the live Google config, validates
 * the CSRF state, then delegates to {@link finishCallback}. Upstream token
 * exchange failures map to 502; a disallowed email maps to 403; an unconfigured
 * Google client maps to 503.
 * @param ctx - Live-runtime accessor and grant callback.
 * @param req - Inbound callback request (carries code, state, and the cookie).
 * @param reply - Reply used to redirect on success or send an error status.
 * @returns The Fastify reply outcome.
 */
async function handleCallback(
  ctx: IGoogleRouteCtx, req: FastifyRequest, reply: FastifyReply,
): Promise<FastifyReply> {
  const resolved = resolveGoogle(ctx);
  if (isFail(resolved)) return await reply.code(503).send({ error: GOOGLE_UNCONFIGURED });
  const { code, error, state } = req.query as { code?: string; error?: string; state?: string };
  if (!state || state !== req.cookies[STATE_COOKIE]) {
    return await reply.code(400).send({ error: 'Invalid state' });
  }
  reply.clearCookie(STATE_COOKIE, { path: '/' });
  if (error) return await reply.code(400).send({ error: 'Google sign-in was cancelled' });
  if (!code) return await reply.code(400).send({ error: 'Missing code' });
  return await finishCallback(resolved.data, ctx, { req, reply, code });
}

/**
 * Registers the callback route that verifies the email and grants the factor.
 * @param app - Fastify instance.
 * @param ctx - Live-runtime accessor and grant callback.
 * @returns Confirmation that the callback route is registered.
 */
function registerCallbackRoute(app: FastifyInstance, ctx: IGoogleRouteCtx): { registered: true } {
  const oauthLimit = { config: { rateLimit: { max: OAUTH_MAX, timeWindow: RATE_WINDOW } } };
  app.get('/auth/google/callback', oauthLimit, (req, reply) => handleCallback(ctx, req, reply));
  return { registered: true };
}

/**
 * Registers the Google consent + callback routes unconditionally. Each request
 * reads the live Google config so the flow reflects UI-saved credentials without
 * a restart and fails cleanly (503) whenever Google sign-in is not configured.
 * @param app - Fastify instance.
 * @param live - Accessor returning the current per-request portal runtime.
 * @param grant - Callback to merge a verified factor into the session.
 * @returns Confirmation that the Google routes are registered.
 */
export function registerGoogleRoutes(
  app: FastifyInstance, live: RuntimeAccessor, grant: GrantFn,
): { registered: true } {
  const ctx: IGoogleRouteCtx = { live, grant };
  registerConsentRoute(app, ctx);
  registerCallbackRoute(app, ctx);
  return { registered: true };
}
