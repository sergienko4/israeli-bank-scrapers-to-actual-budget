/**
 * Root importer configuration (the full `config.json` shape), proxy
 * settings, and scraping resilience policy.
 */

import type { IActualConfig } from './Actual.js';
import type { IBankConfig } from './Bank.js';
import type { ICategorizationConfig } from './Categorization.js';
import type { ILogConfig } from './Logging.js';
import type { INotificationConfig, ISpendingWatchRule } from './Notifications.js';
import type { IPortalConfig } from './Portal.js';

/** Optional SOCKS5/HTTP proxy for Chromium scraping (useful in restricted networks). */
export interface IProxyConfig {
  server: string;  // socks5://host:port or http://host:port
}

/** Root configuration object — represents the full contents of `config.json`. */
export interface IImporterConfig {
  actual: IActualConfig;
  banks: Record<string, IBankConfig>;
  notifications?: INotificationConfig;
  logConfig?: ILogConfig;
  categorization?: ICategorizationConfig;
  spendingWatch?: ISpendingWatchRule[];  // Spending watch rules (empty/missing = disabled)
  delayBetweenBanks?: number;  // Milliseconds to wait between bank imports (default: 0)
  proxy?: IProxyConfig;   // Optional proxy for Chromium (socks5/http)
  portal?: IPortalConfig; // Optional config web portal (disabled by default)
}

export interface IResilienceConfig {
  scrapingTimeoutMs: number;
  maxRetryAttempts: number;
  initialBackoffMs: number;
}

export const DEFAULT_RESILIENCE_CONFIG: IResilienceConfig = {
  scrapingTimeoutMs: 10 * 60 * 1000, // 10 minutes
  maxRetryAttempts: 3,
  initialBackoffMs: 1000 // 1 second
};
