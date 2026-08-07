/**
 * Shared pino logger base options: log level and sensitive-key redaction.
 * Used by both PinoTransports (stdout) and FileLogger (file) to keep
 * redact paths consistent across all log destinations.
 */
import type pino from 'pino';

import type { IImporterConfig } from '../Types/Index.js';

export const REDACT_PATHS = [
  'password', 'token', 'secret', 'auth', 'creditCard', 'cvv',
  'headers.authorization', '*.password', '*.token',
  'phoneNumber', '*.phoneNumber',
];

/**
 * Applies a configured log level so every logger built afterwards honours it.
 *
 * Loggers read the level from the environment at construction time, so the
 * portal's `logConfig.level` is published here rather than threaded through
 * every logger call site. This lets an operator raise verbosity from the
 * portal and re-run without editing files over SSH.
 * @param config - Loaded importer config that may carry `logConfig.level`.
 * @returns The level now in effect for newly built loggers.
 */
export function applyConfiguredLogLevel(config: IImporterConfig): string {
  const level = config.logConfig?.level ?? '';
  if (level !== '') process.env.LOG_LEVEL = level;
  return process.env.LOG_LEVEL ?? 'debug';
}

/**
 * Returns the shared pino base options including log level and redact paths.
 * @returns A pino LoggerOptions object with level and redact configuration.
 */
export function baseOptions(): pino.LoggerOptions {
  return {
    level: process.env.LOG_LEVEL ?? 'debug',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  };
}
