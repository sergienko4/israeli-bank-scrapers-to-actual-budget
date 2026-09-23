/**
 * Shared pino logger base options: log level and sensitive-key redaction.
 * Used by both PinoTransports (stdout) and FileLogger (file) to keep
 * redaction consistent across all log destinations.
 */
import type pino from 'pino';

import type { IImporterConfig } from '../Types/Index.js';
import redactSecrets, { isSecretKey } from './SecretRedaction.js';

const CENSOR = '[REDACTED]';

/**
 * Field names pino hides by exact, case-sensitive match.
 *
 * <p>The log hook masks every call's own context by the text masker's key
 * rule. These names cover what the hook never sees: bare names hide child
 * logger bindings, and `*.` names hide fields one level down. `phoneNumber`
 * is personal data, not a credential, so only this list hides it.
 */
export const REDACT_PATHS = [
  'password', 'token', 'secret', 'auth', 'creditCard', 'cvv',
  '*.password', '*.token', '*.secret', '*.auth', '*.creditCard', '*.cvv',
  'authorization', '*.authorization', 'jwt', '*.jwt', 'id_token', '*.id_token',
  'phoneNumber', '*.phoneNumber',
  // Scraper 8.7.2's names for the durable login token and its session bearer.
  // pino matches exact key names, so `token` above does not cover them.
  'otpLongTermToken', '*.otpLongTermToken', 'longTermToken', '*.longTermToken',
  'persistentOtpToken', '*.persistentOtpToken', 'idToken', '*.idToken',
  'bearer', '*.bearer', 'access_token', '*.access_token',
];

/**
 * Masks secrets quoted in a string.
 * @param value - A log argument or a context field's value.
 * @returns The value, redacted when it is a string.
 */
function redactText(value: unknown): unknown {
  return typeof value === 'string' ? redactSecrets(value) : value;
}

/**
 * Tells whether a log argument is a plain object, such as a call's context.
 * Errors and other class instances are left to pino's serialisers.
 * @param value - One argument of the log call.
 * @returns True for an object literal or a null-prototype object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Masks one context field: a secret key loses its value, text is scanned.
 * @param field - The field's name and value.
 * @returns The field with its value masked where needed.
 */
function redactField(field: [string, unknown]): [string, unknown] {
  const [key, value] = field;
  return [key, isSecretKey(key) ? CENSOR : redactText(value)];
}

/**
 * Masks one argument of a log call.
 *
 * <p>A context object gets a masked copy. Its fields are matched with the
 * text masker's own key rule, which `redact.paths` cannot express: those
 * paths are exact, case-sensitive names, so `authToken` or `Authorization`
 * would pass. `LogContext` is flat, so one level is all a call can carry;
 * deeper fields are left to the exact names in `REDACT_PATHS`.
 * @param value - One argument of the log call.
 * @returns The argument with its secrets masked.
 */
function redactArg(value: unknown): unknown {
  if (!isPlainObject(value)) return redactText(value);
  const fields = Object.entries(value).map(redactField);
  return Object.fromEntries(fields);
}

/**
 * Drops the values a call gives its message's `%s`-style placeholders.
 *
 * <p>A key can sit in the message and its value in an argument, as in
 * `('token: %s', value)`. Masked apart, the pair is missed; filled in first,
 * a value with spaces is only partly hidden. So only the context and the
 * message are kept, and pino, given no values, writes the message as the
 * call wrote it. The importer's own loggers never pass such values. pino
 * takes the message from the first argument, or from the second when the
 * first is an object or undefined; see "Logging Method Parameters" in
 * https://github.com/pinojs/pino/blob/v10.3.1/docs/api.md
 * @param args - The log call's arguments.
 * @returns The context, when the call has one, and the message.
 */
function dropValues(args: unknown[]): unknown[] {
  const at = typeof args[0] === 'object' || args[0] === undefined ? 1 : 0;
  return args.slice(0, at + 1);
}

/**
 * pino `logMethod` hook: masks the context and the message, drops any values.
 *
 * <p>`redact.paths` only hides fields by exact name. Error text reaches the
 * log in the message itself, often quoting a bank's response body, so it is
 * masked here before pino serialises the line.
 * @param this - The pino logger the call was made on.
 * @param args - The log call's arguments.
 * @param method - pino's own method for the call's level.
 * @returns The arguments pino logged, after masking.
 */
function redactMessageArgs(
  this: pino.Logger, args: Parameters<pino.LogFn>, method: pino.LogFn,
): Parameters<pino.LogFn> {
  const masked = dropValues(args).map(redactArg) as Parameters<pino.LogFn>;
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
    redact: { paths: REDACT_PATHS, censor: CENSOR },
    hooks: { logMethod: redactMessageArgs },
  };
}
