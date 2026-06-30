/**
 * Per-route rate-limit ceilings for the portal's authentication endpoints.
 * The server registers a generous global limit; each auth route declares its
 * own `config.rateLimit` literal from these constants to harden the
 * authorization surface (password login, OAuth, status polling) against brute
 * force and to make the protection visible to static analysis as a route-level
 * control.
 */

/** Requests per {@link RATE_WINDOW} allowed on the password-login route. */
export const LOGIN_MAX = 10;
/** Requests per {@link RATE_WINDOW} allowed on the polled auth-status route. */
export const STATUS_MAX = 60;
/** Requests per {@link RATE_WINDOW} allowed on the Google OAuth start/callback routes. */
export const OAUTH_MAX = 20;
/** Shared sliding window applied to every portal auth rate limit. */
export const RATE_WINDOW = '1 minute';
