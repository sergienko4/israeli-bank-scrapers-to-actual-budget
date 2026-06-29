/**
 * Portal config resolution: applies defaults + env overrides and decides
 * whether the portal should boot. Secrets/settings come from IImporterConfig
 * (merged config.json + credentials.json); env wins for host/port/enabled.
 */

import type { IImporterConfig, IPortalConfig, PortalAuthMode } from '../Types/Index.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const MIN_SECRET_LENGTH = 16;
const KNOWN_WEAK_SECRETS = ['change-me-portal-secret'];

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
 * Returns whether the portal is enabled via config flag or PORTAL_ENABLED env.
 * @param config - Merged importer config.
 * @returns True when the portal should start.
 */
export function isPortalEnabled(config: IImporterConfig): boolean {
  if (process.env.PORTAL_ENABLED === 'true') return true;
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
 * Whether a session secret is too weak to safely sign portal cookies.
 *
 * The portal refuses to boot on a weak/missing secret because session cookies
 * are HMAC-signed with it; a guessable key allows trivial session forgery.
 * @param secret - The resolved session secret.
 * @returns True when the secret is empty, too short, or a known placeholder.
 */
export function isSessionSecretWeak(secret: string): boolean {
  return secret.length < MIN_SECRET_LENGTH || KNOWN_WEAK_SECRETS.includes(secret);
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
 * Resolves host/port/auth/secret from config + env, applying safe defaults.
 * @param config - Merged importer config.
 * @returns Resolved runtime settings for the portal server.
 */
export function resolvePortalRuntime(config: IImporterConfig): IPortalRuntime {
  const portal = config.portal ?? { enabled: false };
  return {
    host: process.env.PORTAL_HOST ?? portal.host ?? DEFAULT_HOST,
    port: normalizePort(process.env.PORTAL_PORT ?? portal.port),
    authMode: portal.authMode ?? 'password',
    sessionSecret: portal.sessionSecret ?? '',
    secureCookies: resolveSecureCookies(portal),
    portal,
  };
}
