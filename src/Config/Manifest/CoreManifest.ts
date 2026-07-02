/**
 * Manifest entries for the core importer sections: Actual Budget connection,
 * general root settings (delayBetweenBanks), proxy, and logging.
 */

import { LOG_FORMATS } from '../../Types/Index.js';
import type { IManifestSection } from './ManifestTypes.js';

/** Actual Budget connection section. */
export const ACTUAL_SECTION: IManifestSection = {
  key: 'actual', label: 'Actual', icon: '💰', kind: 'object',
  doc: 'configuration/actual.md',
  fields: [
    {
      key: 'init', label: 'Connection', kind: 'group', fields: [
        {
          key: 'serverURL', label: 'Server URL', kind: 'string', required: true,
          help: 'URL of the Actual Budget server (http:// or https://).',
        },
        {
          key: 'password', label: 'Server password', kind: 'secret', required: true,
          help: 'Actual Budget server password.',
        },
        {
          key: 'dataDir', label: 'Data directory', kind: 'string',
          help: 'Local directory for cached budget data.',
        },
      ],
    },
    {
      key: 'budget', label: 'Budget', kind: 'group', fields: [
        {
          key: 'syncId', label: 'Sync ID', kind: 'string', required: true,
          help: 'UUID of the budget to sync (Actual → Settings → Show Advanced).',
        },
        {
          key: 'password', label: 'Budget password', kind: 'secret',
          help: 'Optional password for an end-to-end encrypted budget.',
        },
      ],
    },
  ],
};

/** General root-level settings; fields live directly at the config root. */
export const GENERAL_SECTION: IManifestSection = {
  key: '', label: 'General', icon: '⚙️', kind: 'object',
  doc: 'getting-started/configuration.md',
  fields: [
    {
      key: 'delayBetweenBanks', label: 'Delay between banks (ms)', kind: 'number', min: 0,
      help: 'Milliseconds to wait between bank imports. Default 0 (no delay).',
    },
  ],
};

/** Optional SOCKS5/HTTP proxy section. */
export const PROXY_SECTION: IManifestSection = {
  key: 'proxy', label: 'Proxy', icon: '🌐', kind: 'object',
  doc: 'configuration/proxy.md',
  fields: [
    {
      key: 'server', label: 'Proxy server', kind: 'string',
      help: 'socks5://host:port or http://host:port (not used with Camoufox yet).',
    },
  ],
};

/** Log output section. */
export const LOG_SECTION: IManifestSection = {
  key: 'logConfig', label: 'Logging', icon: '📝', kind: 'object',
  doc: 'configuration/logging.md',
  fields: [
    {
      key: 'format', label: 'Log format', kind: 'select', options: LOG_FORMATS,
      help: 'words | json | table | phone. Default: words.',
    },
    {
      key: 'logDir', label: 'Log directory', kind: 'string',
      help: 'Directory for rotating log files. Default: ./logs.',
    },
  ],
};
