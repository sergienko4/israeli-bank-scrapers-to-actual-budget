/**
 * Portal config resolution: applies defaults + env overrides and decides
 * whether the portal should boot. Secrets/settings come from IImporterConfig
 * (merged config.json + credentials.json); env wins for host/port/enabled.
 */

import type { IImporterConfig, IPortalConfig, PortalAuthMode } from '../Types/Index.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;
const MIN_SECRET_LENGTH = 16;
const KNOWN_WEAK_SECRETS = ['change-me-portal-secret'];

/** Fully-resolved portal runtime settings. */
export interface IPortalRuntime {
  host: string;
  port: number;
  authMode: PortalAuthMode;
  sessionSecret: string;
  portal: IPortalConfig;
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
    portal,
  };
}
