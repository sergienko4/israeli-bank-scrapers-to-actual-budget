/**
 * Logger interface and types for structured logging
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** SECURITY: Never pass passwords, tokens, or OTP codes in context — exposed via /logs command */
export type LogContext = Record<string, string | number | boolean>;

export interface ILogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}
