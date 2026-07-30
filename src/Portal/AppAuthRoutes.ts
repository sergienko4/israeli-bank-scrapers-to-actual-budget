/**
 * Mobile-app authorization endpoint. The app opens `/auth/app/authorize` in a
 * real browser, the portal's own login UI proves whatever factors the live auth
 * mode demands, and the app receives a single-use code on its custom scheme.
 *
 * The redirect target is never derived from the request: it must match the
 * configured allow-list exactly, and a request that fails validation is answered
 * with a 400 rather than a redirect, so a bad `redirect_uri` can never be used
 * to bounce a victim somewhere the operator did not authorize.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Procedure } from '../Types/Index.js';
import { fail, isFail, succeed } from '../Types/Index.js';
import type { AppAuthCodes } from './AppAuthCodes.js';
import { sanitizeDeviceName } from './AppAuthCodes.js';
import { CHALLENGE_METHOD, isValidChallenge } from './Pkce.js';
import { isAuthorized } from './PortalAuthPolicy.js';
import { OAUTH_MAX, RATE_WINDOW } from './PortalRateLimit.js';
import {
  credentialFingerprint, type IPortalRuntime, portalCookieOptions, type RuntimeAccessor,
} from './PortalRuntime.js';
import type { ISessionPayload } from './PortalSession.js';

const AUTHZ_COOKIE = 'portal_app_authz';
const AUTHZ_MAX_AGE = 600;
const APP_UNCONFIGURED = 'App sign-in is not configured';
const STATE = /^[\w.~-]{1,128}$/;

/** Validated authorize parameters, safe to act on. */
export interface IAuthorizeParams {
  redirectUri: string;
  challenge: string;
  state: string;
  deviceName: string;
}

/** Resolves the caller's cookie session, mirroring the portal's own resolver. */
export type SessionResolver = (
  req: FastifyRequest, rt: IPortalRuntime,
) => Procedure<ISessionPayload>;

/** Collaborators the app auth routes need, injected to avoid an import cycle. */
export interface IAppAuthDeps {
  live: RuntimeAccessor;
  codes: AppAuthCodes;
  sessionOf: SessionResolver;
}

/** Everything the code-minting step needs, grouped to stay within the param cap. */
interface IIssueArgs {
  reply: FastifyReply;
  rt: IPortalRuntime;
  params: IAuthorizeParams;
  session: ISessionPayload;
  codes: AppAuthCodes;
}

/**
 * Validates the authorize query. Every failure names the offending parameter so
 * the app developer can see what is wrong without the portal ever echoing an
 * attacker-supplied value back into a redirect.
 * @param query - Raw query object from Fastify.
 * @param rt - Live runtime carrying the redirect-URI allow-list.
 * @returns Procedure with the validated parameters, or the reason it failed.
 */
export function parseAuthorize(
  query: Record<string, unknown>, rt: IPortalRuntime,
): Procedure<IAuthorizeParams> {
  const redirectUri = typeof query.redirect_uri === 'string' ? query.redirect_uri : '';
  if (!rt.app.redirectUris.includes(redirectUri)) return fail('invalid_redirect_uri');
  const challenge = typeof query.code_challenge === 'string' ? query.code_challenge : '';
  if (!isValidChallenge(challenge)) return fail('invalid_code_challenge');
  if (query.code_challenge_method !== CHALLENGE_METHOD) return fail('unsupported_challenge_method');
  const state = typeof query.state === 'string' ? query.state : '';
  if (!STATE.test(state)) return fail('invalid_state');
  const requested = typeof query.device_name === 'string' ? query.device_name : undefined;
  const deviceName = sanitizeDeviceName(requested);
  return succeed({ redirectUri, challenge, state, deviceName });
}

/**
 * The request's query string exactly as the app sent it, so the login bounce can
 * hand the very same parameters back to this route afterwards.
 * @param req - Incoming request.
 * @returns The raw query string without its leading `?`.
 */
function originalQuery(req: FastifyRequest): string {
  const index = req.url.indexOf('?');
  return index < 0 ? '' : req.url.slice(index + 1);
}

/**
 * Parks the pending authorization in a short-lived signed cookie and sends the
 * browser to the portal login UI, which returns here once the caller is
 * authorized. The cookie is signed so the parked request cannot be swapped for
 * another one while the user is typing their password.
 * @param req - Incoming request.
 * @param reply - Reply used to set the cookie and redirect.
 * @param rt - Live runtime carrying the cookie security flags.
 * @returns The reply after redirecting to the login UI.
 */
function bounceToLogin(
  req: FastifyRequest, reply: FastifyReply, rt: IPortalRuntime,
): FastifyReply {
  const query = originalQuery(req);
  const signed = reply.signCookie(query);
  const options = portalCookieOptions(rt, AUTHZ_MAX_AGE);
  reply.setCookie(AUTHZ_COOKIE, signed, options);
  const target = `/auth/app/authorize?${query}`;
  const next = encodeURIComponent(target);
  return reply.redirect(`/?next=${next}`);
}

/**
 * Mints the single-use code and hands it to the app on its own scheme. The code
 * records the factors and credential fingerprint in force right now, so a
 * credential change between here and the token exchange invalidates it.
 * @param args - Reply, runtime, validated parameters, session, and code store.
 * @returns The reply after redirecting to the app.
 */
function issueCode(args: IIssueArgs): FastifyReply {
  const { reply, rt: runtime, params, session, codes } = args;
  const record = codes.mint({
    challenge: params.challenge,
    redirectUri: params.redirectUri,
    factors: { google: session.google, password: session.password },
    email: session.email,
    fingerprint: credentialFingerprint(runtime),
    deviceName: params.deviceName,
  });
  reply.clearCookie(AUTHZ_COOKIE, { path: '/' });
  return reply.redirect(`${params.redirectUri}?code=${record.code}&state=${params.state}`);
}

/**
 * Handles `GET /auth/app/authorize`.
 * @param req - Incoming request.
 * @param reply - Reply.
 * @param deps - Live runtime accessor, code store, and session resolver.
 * @returns The reply after redirecting or reporting the rejection.
 */
function handleAuthorize(
  req: FastifyRequest, reply: FastifyReply, deps: IAppAuthDeps,
): FastifyReply {
  const rt = deps.live();
  if (!rt.app.enabled) return reply.code(503).send({ error: APP_UNCONFIGURED });
  const query = req.query as Record<string, unknown>;
  const params = parseAuthorize(query, rt);
  if (isFail(params)) return reply.code(400).send({ error: params.message });
  const session = deps.sessionOf(req, rt);
  const isAllowed = isFail(session) ? false : isAuthorized(session.data, rt.authMode);
  if (isFail(session) || !isAllowed) return bounceToLogin(req, reply, rt);
  const issue = { reply, rt, params: params.data, session: session.data, codes: deps.codes };
  return issueCode(issue);
}

/**
 * Registers the app authorization route under the OAuth rate limit.
 * @param app - Fastify instance.
 * @param deps - Live runtime accessor, code store, and session resolver.
 * @returns Confirmation that the app auth routes are registered.
 */
export function registerAppAuthRoutes(
  app: FastifyInstance, deps: IAppAuthDeps,
): { registered: true } {
  const limit = { config: { rateLimit: { max: OAUTH_MAX, timeWindow: RATE_WINDOW } } };
  app.get('/auth/app/authorize', limit, (req, reply) => handleAuthorize(req, reply, deps));
  return { registered: true };
}
