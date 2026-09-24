/**
 * Shared pino logger base options: log level and sensitive-key redaction.
 * Used by both PinoTransports (stdout) and FileLogger (file) to keep
 * redaction consistent across all log destinations.
 */
import type pino from 'pino';

import type { IImporterConfig } from '../Types/Index.js';
import redactSecrets, { isSecretKey } from './SecretRedaction.js';

const CENSOR = '[REDACTED]';

/** The JSON methods that keep a number's exact text; ES2022 types omit them. */
interface IRawJson {
  /**
   * Wraps JSON text so `JSON.stringify` writes it unchanged.
   * @param text - The exact JSON text of a number.
   * @returns A value `JSON.stringify` writes as that text.
   */
  rawJSON: (text: string) => unknown;
  /**
   * Tells whether a value was made by `rawJSON`.
   * @param value - Any parsed value.
   * @returns True for a wrapped JSON text.
   */
  isRawJSON: (value: unknown) => boolean;
}

/** The context Node's `JSON.parse` passes a reviver: the value's own text. */
interface IParseContext {
  readonly source: string;
}

/** `JSON`, with the exact-text methods Node 22 and later provide. */
const RAW_JSON = JSON as unknown as IRawJson;

/**
 * `JSON.parse` reviver: keeps each number as the text pino wrote, so the line
 * is written back unchanged; a logged `BigInt` a double would round included.
 * @param _key - The field name, not needed.
 * @param value - The parsed value.
 * @param context - The value's source text, which Node passes a reviver.
 * @returns The value, or a number's exact text.
 */
function keepExactNumber(_key: string, value: unknown, context?: IParseContext): unknown {
  const isNumber = typeof value === 'number' && context !== undefined;
  return isNumber ? RAW_JSON.rawJSON(context.source) : value;
}

/**
 * Masks secrets anywhere in a parsed log line.
 *
 * <p>Parsed JSON holds only text, numbers, booleans, null, lists and plain
 * objects, so there is no cycle, getter or class instance to guard against;
 * a number kept as its exact text is written back as it is.
 * @param value - The parsed line, or any value inside it.
 * @returns A copy with every secret field hidden and every text masked.
 */
function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value !== 'object' || value === null || RAW_JSON.isRawJSON(value)) return value;
  const fields = Object.entries(value).map(redactField);
  return Object.fromEntries(fields);
}

/**
 * Masks one field of a parsed log line: a secret key loses its value.
 *
 * <p>The name is masked as text too, since a caller can build one from a
 * secret. Two names masked to the same text keep the last field's value.
 * @param field - The field's name and value.
 * @returns The field, its value hidden, or masked in turn.
 */
function redactField(field: [string, unknown]): [string, unknown] {
  const [key, value] = field;
  const name = redactSecrets(key);
  return [name, isSecretKey(key) ? CENSOR : redactValue(value)];
}

/**
 * pino `streamWrite` hook: masks secrets in a finished log line.
 *
 * <p>Every line passes here on its way to a destination, so this covers what
 * pino's own options cannot. `redact.paths` are exact, case-sensitive names
 * with no any-depth wildcard, and `formatters.bindings` runs once, before any
 * child logger exists. So field names, fields at any depth, lists, child
 * bindings and a logged `Error` are all masked here, by the text masker's key
 * rule. pino writes a key twice when a child binding and a call's field share
 * it; `JSON.parse` keeps the last. A line that cannot be walked is masked as
 * text by the same keys, so logging never throws: pino writes an own
 * `constructor` field's value unquoted, and a line nested deep enough
 * overflows the walk. See `streamWrite` and `bindings` in
 * https://github.com/pinojs/pino/blob/v10.3.1/docs/api.md
 * @param line - One serialised log line, with its line ending.
 * @returns The line with every secret masked, and the same line ending.
 */
export function redactLogLine(line: string): string {
  const content = line.trimEnd();
  const ending = line.slice(content.length);
  try {
    const parsed = JSON.parse(content, keepExactNumber) as unknown;
    const masked = redactValue(parsed);
    return JSON.stringify(masked) + ending;
  } catch {
    return redactSecrets(line);
  }
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
 * pino `logMethod` hook: logs the call without its `%s`-style values.
 * @param this - The pino logger the call was made on.
 * @param args - The log call's arguments.
 * @param method - pino's own method for the call's level.
 * @returns The arguments pino logged.
 */
function logWithoutValues(
  this: pino.Logger, args: Parameters<pino.LogFn>, method: pino.LogFn,
): Parameters<pino.LogFn> {
  const kept = dropValues(args) as Parameters<pino.LogFn>;
  method.apply(this, kept);
  return kept;
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
 * Returns the shared pino base options: log level, the hook that drops
 * `%s`-style values and the line masker.
 * @returns A pino LoggerOptions object with level and redaction configuration.
 */
export function baseOptions(): pino.LoggerOptions {
  return {
    level: process.env.LOG_LEVEL ?? 'debug',
    hooks: { logMethod: logWithoutValues, streamWrite: redactLogLine },
  };
}
