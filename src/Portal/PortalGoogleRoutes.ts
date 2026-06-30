/**
 * Google OAuth routes for the portal, split out to keep the auth-route file
 * under its line cap. /auth/google starts consent; the callback verifies the
 * email against the allow-list before granting the `google` factor.
 */

import { randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { IPortalGoogleConfig } from '../Types/Index.js';
import { isFail } from '../Types/Index.js';
import { buildAuthUrl, exchangeCode } from './GoogleOAuth.js';
import { isEmailAllowed } from './PortalAuthPolicy.js';
import { OAUTH_MAX, RATE_WINDOW } from './PortalRateLimit.js';
import { type IPortalRuntime, portalCookieOptions } from './PortalRuntime.js';
import type { ISessionPayload } from './PortalSession.js';

const STATE_COOKIE = 'portal_oauth_state';
const STATE_MAX_AGE = 600;

/** Factor-granting callback inputs supplied by the auth-routes module. */
export interface IGrantArgs {
  req: FastifyRequest;
  reply: FastifyReply;
  rt: IPortalRuntime;
  factor: Partial<ISessionPayload>;
}

/** Merges a verified factor into the session cookie; reports completion. */
export type GrantFn = (args: IGrantArgs) => { granted: true };

/** Resolved runtime, factor-granting callback, and verified Google config. */
interface IGoogleRouteCtx {
  rt: IPortalRuntime;
  grant: GrantFn;
  google: IPortalGoogleConfig;
}

/**
 * Registers the consent-start route that redirects to Google's OAuth screen.
 * @param app - Fastify instance.
 * @param rt - Resolved portal runtime (drives the cookie Secure flag).
 * @param google - Verified portal Google config.
 * @returns Confirmation that the consent route is registered.
 */
function registerConsentRoute(
  app: FastifyInstance, rt: IPortalRuntime, google: IPortalGoogleConfig,
): { registered: true } {
  const oauthLimit = { config: { rateLimit: { max: OAUTH_MAX, timeWindow: RATE_WINDOW } } };
  app.get('/auth/google', oauthLimit, (_req, reply) => {
    const state = randomBytes(16).toString('hex');
    const cookieOpts = portalCookieOptions(rt, STATE_MAX_AGE);
    reply.setCookie(STATE_COOKIE, state, cookieOpts);
    const url = buildAuthUrl(google, state);
    return reply.redirect(url);
  });
  return { registered: true };
}

/**
 * Handles the Google OAuth callback: validates the CSRF state, exchanges the
 * code for a verified email, and grants the factor when that email is
 * allow-listed. Upstream Google/token exchange failures map to 502 (a server-side
 * problem), kept distinct from a disallowed email's 403.
 * @param ctx - Runtime, grant callback, and verified Google config.
 * @param req - Inbound callback request (carries code, state, and the cookie).
 * @param reply - Reply used to redirect on success or send an error status.
 * @returns The Fastify reply outcome.
 */
async function handleCallback(
  ctx: IGoogleRouteCtx, req: FastifyRequest, reply: FastifyReply,
): Promise<FastifyReply> {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !state || state !== req.cookies[STATE_COOKIE]) {
    return await reply.code(400).send({ error: 'Invalid state' });
  }
  reply.clearCookie(STATE_COOKIE, { path: '/' });
  const email = await exchangeCode(ctx.google, code);
  if (isFail(email)) {
    return await reply.code(502).send({ error: 'Google sign-in failed' });
  }
  if (!isEmailAllowed(email.data, ctx.google.allowedEmails ?? [])) {
    return await reply.code(403).send({ error: 'Email not allowed' });
  }
  ctx.grant({ req, reply, rt: ctx.rt, factor: { google: true, email: email.data } });
  return await reply.redirect('/');
}

/**
 * Registers the callback route that verifies the email and grants the factor.
 * @param app - Fastify instance.
 * @param ctx - Runtime, grant callback, and verified Google config.
 * @returns Confirmation that the callback route is registered.
 */
function registerCallbackRoute(app: FastifyInstance, ctx: IGoogleRouteCtx): { registered: true } {
  const oauthLimit = { config: { rateLimit: { max: OAUTH_MAX, timeWindow: RATE_WINDOW } } };
  app.get('/auth/google/callback', oauthLimit, (req, reply) => handleCallback(ctx, req, reply));
  return { registered: true };
}

/**
 * Registers the Google consent + callback routes when Google is configured.
 * @param app - Fastify instance.
 * @param rt - Resolved runtime (google config).
 * @param grant - Callback to merge a verified factor into the session.
 * @returns Whether the Google routes were registered (skipped when unconfigured).
 */
export function registerGoogleRoutes(
  app: FastifyInstance, rt: IPortalRuntime, grant: GrantFn,
): { registered: boolean } {
  const google = rt.portal.google;
  if (!google) return { registered: false };
  registerConsentRoute(app, rt, google);
  registerCallbackRoute(app, { rt, grant, google });
  return { registered: true };
}
