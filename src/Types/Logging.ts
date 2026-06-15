/**
 * Log output configuration.
 */

export type LogFormat = 'words' | 'json' | 'table' | 'phone';

export interface ILogConfig {
  format?: LogFormat;          // Default: 'words'
  maxBufferSize?: number;      // Deprecated: kept for backward compat, no longer functional
  logDir?: string;             // Log file directory. Default: './logs'
}
