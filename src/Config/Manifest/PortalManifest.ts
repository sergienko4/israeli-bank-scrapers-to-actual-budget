/**
 * Manifest entry for the config-portal section (the portal that serves this UI).
 */

import { PORTAL_AUTH_MODES } from '../../Types/Index.js';
import type { IManifestSection } from './ManifestTypes.js';

/** Config-portal section. */
const PORTAL_SECTION: IManifestSection = {
  key: 'portal', label: 'Portal', icon: '🖥️', kind: 'object',
  doc: 'configuration/portal.md',
  fields: [
    {
      key: 'enabled', label: 'Enabled', kind: 'boolean',
      help: 'Start the config web portal.',
    },
    {
      key: 'host', label: 'Host', kind: 'string',
      help: '127.0.0.1 (local only) or 0.0.0.0 to expose.',
    },
    {
      key: 'port', label: 'Port', kind: 'number', min: 1, max: 65535,
      help: 'Listen port. Default 8080.',
    },
    {
      key: 'authMode', label: 'Auth mode', kind: 'select', options: PORTAL_AUTH_MODES,
      help: 'password | google | both.',
    },
    {
      key: 'secureCookies', label: 'Secure cookies', kind: 'boolean',
      help: 'Mark session cookies Secure. Enable only when served over HTTPS.',
    },
    {
      key: 'passwordHash', label: 'Password hash', kind: 'secret',
      help: 'scrypt hash for password auth (managed for you).',
    },
    {
      key: 'sessionSecret', label: 'Session secret', kind: 'secret',
      help: 'Signing key for session cookies (>= 16 chars).',
    },
    {
      key: 'google', label: 'Google OAuth', kind: 'group', fields: [
        { key: 'clientId', label: 'Client id', kind: 'string', help: 'Google OAuth client id.' },
        {
          key: 'clientSecret', label: 'Client secret', kind: 'secret',
          help: 'Google OAuth client secret.',
        },
        { key: 'redirectUri', label: 'Redirect URI', kind: 'string', help: 'OAuth callback URL.' },
        {
          key: 'allowedEmails', label: 'Allowed emails', kind: 'list',
          help: 'Allow-listed Google emails.',
        },
      ],
    },
  ],
};

export default PORTAL_SECTION;
