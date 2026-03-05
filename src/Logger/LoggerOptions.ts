/**
 * Shared pino logger base options: log level and sensitive-key redaction.
 * Used by both PinoTransports (stdout) and FileLogger (file) to keep
 * redact paths consistent across all log destinations.
 */
import type pino from 'pino';

export const REDACT_PATHS = [
  'password', 'token', 'secret', 'auth', 'creditCard', 'cvv',
  'headers.authorization', '*.password', '*.token',
];

export function baseOptions(): pino.LoggerOptions {
  return {
    level: process.env['LOG_LEVEL'] ?? 'debug',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  };
}
