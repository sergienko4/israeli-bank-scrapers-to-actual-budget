/**
 * Portal config resolution: applies defaults + env overrides and decides
 * whether the portal should boot. Secrets/settings come from IImporterConfig
 * (merged config.json + credentials.json); env wins for host/port/enabled.
 */

import type { IImporterConfig, IPortalConfig, PortalAuthMode } from '../Types/Index.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;

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
 * Resolves host/port/auth/secret from config + env, applying safe defaults.
 * @param config - Merged importer config.
 * @returns Resolved runtime settings for the portal server.
 */
export function resolvePortalRuntime(config: IImporterConfig): IPortalRuntime {
  const portal = config.portal ?? { enabled: false };
  return {
    host: process.env.PORTAL_HOST ?? portal.host ?? DEFAULT_HOST,
    port: Number(process.env.PORTAL_PORT ?? portal.port ?? DEFAULT_PORT),
    authMode: portal.authMode ?? 'password',
    sessionSecret: portal.sessionSecret ?? 'change-me-portal-secret',
    portal,
  };
}
