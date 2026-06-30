/**
 * Explicit per-route rate limits for the portal's authentication endpoints.
 * The server registers a generous global limit; these stricter per-route limits
 * harden the authorization surface (password login, OAuth) against brute force
 * and make the protection visible to static analysis as a route-level control.
 */

import type { RouteShorthandOptions } from 'fastify';

/** Requests per window allowed on the password-login route (anti-brute-force). */
const LOGIN_MAX = 10;
/** Requests per window allowed on the frequently-polled auth-status route. */
const STATUS_MAX = 60;
/** Requests per window allowed on the Google OAuth start and callback routes. */
const OAUTH_MAX = 20;
/** Shared sliding window applied to every portal auth rate limit. */
const WINDOW = '1 minute';

/**
 * Builds Fastify route options carrying an explicit per-route rate limit.
 * @param max - Maximum requests permitted within the shared time window.
 * @returns Route options that enable @fastify/rate-limit for the route.
 */
function limited(max: number): RouteShorthandOptions {
  return { config: { rateLimit: { max, timeWindow: WINDOW } } };
}

/** Strict per-route limit for the password-login endpoint. */
export const LOGIN_RATE_LIMIT: RouteShorthandOptions = limited(LOGIN_MAX);
/** Generous per-route limit for the polled auth-status endpoint. */
export const STATUS_RATE_LIMIT: RouteShorthandOptions = limited(STATUS_MAX);
/** Per-route limit for the Google OAuth start and callback endpoints. */
export const OAUTH_RATE_LIMIT: RouteShorthandOptions = limited(OAUTH_MAX);
