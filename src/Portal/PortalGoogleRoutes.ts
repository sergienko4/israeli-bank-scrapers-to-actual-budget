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

/**
 * Registers the Google consent + callback routes when Google is configured.
 * @param app - Fastify instance.
 * @param rt - Resolved runtime (google config).
 * @param grant - Callback to merge a verified factor into the session.
 * @returns Whether the Google routes were registered (skipped when unconfigured).
 */
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
  app.get('/auth/google', (_req, reply) => {
    const state = randomBytes(16).toString('hex');
    const cookieOpts = portalCookieOptions(rt, STATE_MAX_AGE);
    reply.setCookie(STATE_COOKIE, state, cookieOpts);
    const url = buildAuthUrl(google, state);
    return reply.redirect(url);
  });
  return { registered: true };
}

/**
 * Registers the callback route that verifies the email and grants the factor.
 * @param app - Fastify instance.
 * @param ctx - Runtime, grant callback, and verified Google config.
 * @returns Confirmation that the callback route is registered.
 */
function registerCallbackRoute(app: FastifyInstance, ctx: IGoogleRouteCtx): { registered: true } {
  const { rt: runtime, grant, google } = ctx;
  app.get('/auth/google/callback', async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    const expected = req.cookies[STATE_COOKIE];
    if (!code || !state || state !== expected) {
      return await reply.code(400).send({ error: 'Invalid state' });
    }
    reply.clearCookie(STATE_COOKIE, { path: '/' });
    const email = await exchangeCode(google, code);
    if (isFail(email) || !isEmailAllowed(email.data, google.allowedEmails)) {
      return await reply.code(403).send({ error: 'Email not allowed' });
    }
    grant({ req, reply, rt: runtime, factor: { google: true, email: email.data } });
    return await reply.redirect('/');
  });
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
