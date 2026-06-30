/**
 * Portal config resolution: applies defaults + env overrides and decides
 * whether the portal should boot. Secrets/settings come from IImporterConfig
 * (merged config.json + credentials.json); env wins for host/port/enabled.
 */

import type { IImporterConfig, IPortalConfig, IPortalGoogleConfig, PortalAuthMode } from '../Types/Index.js';
import { PORTAL_AUTH_MODES } from '../Types/Index.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const MIN_SECRET_LENGTH = 16;
const KNOWN_WEAK_SECRETS = new Set(['change-me-portal-secret']);

/** Fully-resolved portal runtime settings. */
export interface IPortalRuntime {
  host: string;
  port: number;
  authMode: PortalAuthMode;
  sessionSecret: string;
  secureCookies: boolean;
  portal: IPortalConfig;
}

/** Cookie attributes shared by every portal cookie. */
export interface ICookieOptions {
  path: string;
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  maxAge?: number;
}

/**
 * Builds cookie attributes for portal cookies, marking them Secure when the
 * runtime requires it (HTTPS deployments behind a TLS-terminating proxy).
 * @param rt - Resolved portal runtime.
 * @param maxAge - Optional max-age in seconds (omitted for session cookies).
 * @returns Cookie options carrying the resolved Secure flag.
 */
export function portalCookieOptions(rt: IPortalRuntime, maxAge?: number): ICookieOptions {
  const base: ICookieOptions = {
    path: '/', httpOnly: true, sameSite: 'lax', secure: rt.secureCookies,
  };
  return maxAge === undefined ? base : { ...base, maxAge };
}

/**
 * Returns whether the portal should boot. `PORTAL_ENABLED` is a full override:
 * its `true`/`false` value wins over `config.portal.enabled` in both directions,
 * so an operator can force the portal on, or force a config-enabled portal off,
 * without editing config files.
 * @param config - Merged importer config.
 * @returns True when the portal should start.
 */
export function isPortalEnabled(config: IImporterConfig): boolean {
  if (process.env.PORTAL_ENABLED === 'true') return true;
  if (process.env.PORTAL_ENABLED === 'false') return false;
  return config.portal?.enabled === true;
}

/**
 * Coerces an env/config port into a valid positive integer, else the default.
 * @param value - Raw port from env (string) or config (number), possibly unset.
 * @returns A valid listen port, falling back to {@link DEFAULT_PORT}.
 */
function normalizePort(value?: string | number): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT;
}

/**
 * Resolves the portal bind host: a non-blank `PORTAL_HOST` env wins, else the
 * config host, else the loopback default. A blank or whitespace-only env value
 * is ignored so it can never override config with an empty string (which `??`
 * would otherwise accept as present).
 * @param envHost - Raw `PORTAL_HOST` value, possibly unset or blank.
 * @param configHost - Host from the portal config block, if any.
 * @returns The resolved bind host.
 */
function resolveHost(envHost?: string, configHost?: string): string {
  const trimmed = envHost?.trim() ?? '';
  if (trimmed !== '') return trimmed;
  return configHost ?? DEFAULT_HOST;
}

/**
 * Resolves the portal listen port: a non-blank `PORTAL_PORT` env wins, else the
 * config port, each normalized to a valid positive integer (else the default).
 * A blank or whitespace-only env value is ignored so it can never mask a
 * configured port by collapsing straight to the default.
 * @param envPort - Raw `PORTAL_PORT` value, possibly unset or blank.
 * @param configPort - Port from the portal config block, if any.
 * @returns A valid listen port.
 */
function resolvePort(envPort?: string, configPort?: number): number {
  const trimmed = envPort?.trim() ?? '';
  return trimmed === '' ? normalizePort(configPort) : normalizePort(trimmed);
}

/**
 * Whether a session secret is too weak to safely sign portal cookies.
 *
 * The portal refuses to boot on a weak/missing secret because session cookies
 * are HMAC-signed with it; a guessable key allows trivial session forgery.
 * @param secret - The resolved session secret.
 * @returns True when the secret is empty, too short, or a known placeholder.
 */
export function isSessionSecretWeak(secret: string): boolean {
  return secret.length < MIN_SECRET_LENGTH || KNOWN_WEAK_SECRETS.has(secret);
}

/**
 * Resolves whether portal cookies should carry the `Secure` attribute. Enable
 * for HTTPS deployments (e.g. behind a TLS reverse proxy); keep it off for
 * plain-HTTP localhost/LAN so browsers still send the cookie. `PORTAL_SECURE_COOKIES`
 * env wins over the config flag.
 * @param portal - Portal config block.
 * @returns True when cookies must be marked Secure.
 */
export function resolveSecureCookies(portal: IPortalConfig): boolean {
  const override = process.env.PORTAL_SECURE_COOKIES;
  if (override === 'true') return true;
  if (override === 'false') return false;
  return portal.secureCookies === true;
}

/**
 * Whether the resolved bind host exposes the portal beyond loopback.
 *
 * A non-loopback bind (e.g. `0.0.0.0` or a LAN address) makes the portal
 * reachable from the network, so session cookies and freshly typed secrets
 * traverse the wire unless a TLS reverse proxy fronts it. Callers use this to
 * emit a boot warning recommending HTTPS + `PORTAL_SECURE_COOKIES`.
 * @param host - Resolved listen host.
 * @returns True when the host is not a loopback address.
 */
export function isNonLoopbackHost(host: string): boolean {
  return !LOOPBACK_HOSTS.has(host);
}

/**
 * Coerces a raw auth mode to a known {@link PortalAuthMode}, defaulting unknown
 * or missing values to `password` so a hand-edited typo can never reach the
 * factor check with no policy (which would otherwise fail the login request).
 * @param mode - Raw authMode from config (possibly invalid or undefined).
 * @returns A valid portal auth mode.
 */
function normalizeAuthMode(mode?: string): PortalAuthMode {
  return PORTAL_AUTH_MODES.includes(mode as PortalAuthMode) ? (mode as PortalAuthMode) : 'password';
}

/**
 * Resolves host/port/auth/secret from config + env, applying safe defaults.
 * @param config - Merged importer config.
 * @returns Resolved runtime settings for the portal server.
 */
export function resolvePortalRuntime(config: IImporterConfig): IPortalRuntime {
  const portal = config.portal ?? { enabled: false };
  return {
    host: resolveHost(process.env.PORTAL_HOST, portal.host),
    port: resolvePort(process.env.PORTAL_PORT, portal.port),
    authMode: normalizeAuthMode(portal.authMode),
    sessionSecret: portal.sessionSecret ?? '',
    secureCookies: resolveSecureCookies(portal),
    portal,
  };
}

/**
 * Whether a config string carries a real, non-blank value.
 *
 * Whitespace-only OAuth fields satisfy a plain truthiness check yet can never
 * authenticate anyone, so they must be treated as missing.
 * @param value - Candidate string from config (possibly undefined or blank).
 * @returns True when the value is a non-empty, non-whitespace string.
 */
function hasText(value?: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Whether a Google OAuth config has every field needed to run the consent flow
 * AND admit at least one user. Blank/whitespace-only fields count as missing,
 * and without a non-blank allowedEmails entry the consent flow completes but
 * every login is rejected, so the portal would boot un-loginable in google/both
 * mode.
 * @param google - Portal Google config, if present.
 * @returns True when clientId, clientSecret, redirectUri, and at least one
 *          allowedEmails entry are all present and non-blank.
 */
function isGoogleConfigComplete(google?: IPortalGoogleConfig): boolean {
  if (!google) return false;
  return hasText(google.clientId)
    && hasText(google.clientSecret)
    && hasText(google.redirectUri)
    && Boolean(google.allowedEmails?.some(hasText));
}

/**
 * Validates that the resolved auth mode has the credential(s) it needs to log
 * in, so the portal never boots into an un-loginable state — e.g. `password`/
 * `both` with no passwordHash, or `google`/`both` with an incomplete Google
 * client. This closes the silent lockout users hit as "both doesn't work".
 * @param rt - Resolved portal runtime.
 * @returns An actionable error message, or '' when the auth config is bootable.
 */
export function portalAuthConfigError(rt: IPortalRuntime): string {
  const mode = rt.authMode;
  if ((mode === 'password' || mode === 'both') && !rt.portal.passwordHash) {
    return 'set portal.passwordHash for password/both mode (type a password in the portal, then restart)';
  }
  if ((mode === 'google' || mode === 'both') && !isGoogleConfigComplete(rt.portal.google)) {
    return 'set portal.google.clientId, clientSecret, redirectUri, and at least one allowedEmails entry for google/both mode';
  }
  return '';
}

/**
 * Single reason the portal must refuse to boot, or '' when it is safe to start:
 * a weak session secret (cookie-forgery risk) or an un-loginable auth config.
 * @param rt - Resolved portal runtime.
 * @returns A boot-blocking reason, or '' when the portal may start.
 */
export function portalBootBlocker(rt: IPortalRuntime): string {
  if (isSessionSecretWeak(rt.sessionSecret)) {
    return 'set a strong portal.sessionSecret (>=16 chars) in credentials.json';
  }
  return portalAuthConfigError(rt);
}
