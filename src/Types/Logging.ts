/**
 * Log output configuration.
 */

/** Log output format options (single source for type + UI). */
export const LOG_FORMATS = ['words', 'json', 'table', 'phone'] as const;

/** Log output format. Default: 'words'. */
export type LogFormat = typeof LOG_FORMATS[number];

/**
 * Log verbosity levels the portal can select (single source for type + UI).
 * 'debug' and 'trace' additionally turn on scraper login diagnostics.
 */
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;

/** Configured log verbosity. Default: 'info'. */
export type LogLevelSetting = typeof LOG_LEVELS[number];

export interface ILogConfig {
  format?: LogFormat;          // Default: 'words'
  level?: LogLevelSetting;     // Default: 'info'. 'debug'/'trace' also enable scraper diagnostics
  maxBufferSize?: number;      // Deprecated: kept for backward compat, no longer functional
  logDir?: string;             // Log file directory. Default: './logs'
}
