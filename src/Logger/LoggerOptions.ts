/**
 * Shared pino logger base options: log level and sensitive-key redaction.
 * Used by both PinoTransports (stdout) and FileLogger (file) to keep
 * redaction consistent across all log destinations.
 */
import type pino from 'pino';

import type { IImporterConfig } from '../Types/Index.js';
import redactSecrets from './SecretRedaction.js';

export const REDACT_PATHS = [
  'password', 'token', 'secret', 'auth', 'creditCard', 'cvv',
  'headers.authorization', '*.password', '*.token',
  'phoneNumber', '*.phoneNumber',
  // Scraper 8.7.2's names for the durable login token and its session bearer.
  // pino matches exact key names, so `token` above does not cover them.
  'otpLongTermToken', '*.otpLongTermToken', 'longTermToken', '*.longTermToken',
  'persistentOtpToken', '*.persistentOtpToken', 'idToken', '*.idToken',
  'bearer', '*.bearer', 'access_token', '*.access_token',
];

/**
 * Masks secrets quoted in a log call's string arguments.
 * @param value - One argument of the log call.
 * @returns The argument, redacted when it is a string.
 */
function redactArg(value: unknown): unknown {
  return typeof value === 'string' ? redactSecrets(value) : value;
}

/**
 * pino `logMethod` hook: masks the message and its interpolation values.
 *
 * <p>`redact.paths` only hides structured fields. Error text reaches the log
 * in the message itself, often quoting a bank's response body, so it is
 * masked here before pino serialises the line.
 * @param this - The pino logger the call was made on.
 * @param args - The log call's arguments.
 * @param method - pino's own method for the call's level.
 * @returns The arguments pino logged, after masking.
 */
function redactMessageArgs(
  this: pino.Logger, args: Parameters<pino.LogFn>, method: pino.LogFn,
): Parameters<pino.LogFn> {
  const masked = args.map(redactArg) as Parameters<pino.LogFn>;
  method.apply(this, masked);
  return masked;
}

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
 * Returns the shared pino base options: log level, redact paths and the
 * message-masking hook.
 * @returns A pino LoggerOptions object with level and redaction configuration.
 */
export function baseOptions(): pino.LoggerOptions {
  return {
    level: process.env.LOG_LEVEL ?? 'debug',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    hooks: { logMethod: redactMessageArgs },
  };
}
