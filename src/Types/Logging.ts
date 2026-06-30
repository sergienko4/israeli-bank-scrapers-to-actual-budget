/**
 * Log output configuration.
 */

/** Log output format options (single source for type + UI). */
export const LOG_FORMATS = ['words', 'json', 'table', 'phone'] as const;

/** Log output format. Default: 'words'. */
export type LogFormat = typeof LOG_FORMATS[number];

export interface ILogConfig {
  format?: LogFormat;          // Default: 'words'
  maxBufferSize?: number;      // Deprecated: kept for backward compat, no longer functional
  logDir?: string;             // Log file directory. Default: './logs'
}
