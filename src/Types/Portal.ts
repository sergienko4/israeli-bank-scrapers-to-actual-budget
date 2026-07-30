/**
 * Config-portal settings. The optional web portal lets users view/edit the
 * full importer config (incl. secrets) from phone, tablet, or desktop. Secret
 * fields (passwordHash, sessionSecret, google.clientSecret) belong in
 * credentials.json; non-secret fields belong in config.json.
 */

/** Portal authentication modes (single source for type + UI). */
export const PORTAL_AUTH_MODES = ['password', 'google', 'both'] as const;

/** Authentication mode. `both` = Google first, then portal password. */
export type PortalAuthMode = typeof PORTAL_AUTH_MODES[number];

/** Google OAuth settings; clientSecret is a secret (credentials.json). */
export interface IPortalGoogleConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  allowedEmails?: string[]; // Optional in JSON; absent/empty blocks every google login (see PortalRuntime).
}

/** Mobile-app sign-in settings; see PortalAppConfig for resolution + defaults. */
export interface IPortalAppConfig {
  enabled?: boolean;              // Default: false
  redirectUris?: string[];        // Exact-match allow-list, e.g. ['bankimporter://auth']
  accessTokenTtlMinutes?: number; // 1-60. Default: 15
  refreshTokenTtlDays?: number;   // 1-365. Default: 60
}

/** Root portal configuration; merged from config.json + credentials.json. */
export interface IPortalConfig {
  enabled: boolean;
  host?: string;             // Bind address. Default: 127.0.0.1
  port?: number;             // Listen port. Default: 8080
  authMode?: PortalAuthMode; // Default: 'password'
  secureCookies?: boolean;   // Mark cookies Secure (enable behind HTTPS). Default: false
  passwordHash?: string;     // scrypt hash for password auth (secret)
  sessionSecret?: string;    // signing key for session cookies (secret)
  google?: IPortalGoogleConfig;
  app?: IPortalAppConfig;
}
