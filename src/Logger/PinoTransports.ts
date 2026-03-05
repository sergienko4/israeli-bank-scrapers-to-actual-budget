/**
 * pino instance factory — one instance per LogFormat.
 * Uses pino-pretty as a synchronous transform stream (no worker threads).
 */
import pino from 'pino';
import pinoPretty from 'pino-pretty';
import type { LogFormat } from '../Types/Index.js';
import { baseOptions } from './LoggerOptions.js';

const transportFactories: Record<LogFormat, () => pino.Logger> = {
  words: createWordsLogger,
  json: createJsonLogger,
  table: createTableLogger,
  phone: createPhoneLogger,
};

/**
 * Creates a pino logger instance configured for the given log format.
 * @param format - The desired log format (words, json, table, or phone).
 * @returns A configured pino.Logger instance.
 */
export function createPinoInstance(format: LogFormat): pino.Logger {
  const factory = transportFactories[format] ?? transportFactories.words;
  return factory();
}

/**
 * Creates a colourised human-readable pino logger for terminal output.
 * @returns A pino logger with pino-pretty colorized output.
 */
function createWordsLogger(): pino.Logger {
  return pino(baseOptions(), pinoPretty({ colorize: true }));
}

/**
 * Creates a raw JSON pino logger with no pretty-printing.
 * @returns A pino logger writing plain NDJSON to stdout.
 */
function createJsonLogger(): pino.Logger {
  return pino(baseOptions());
}

/**
 * Creates a table-style pino logger, without colour or extra fields.
 * @returns A pino logger with pino-pretty table formatting.
 */
function createTableLogger(): pino.Logger {
  return pino(baseOptions(), pinoPretty({ colorize: false, ignore: 'pid,hostname' }));
}

/**
 * Creates a minimal phone-friendly pino logger showing only the message.
 * @returns A pino logger stripped to message-only output.
 */
function createPhoneLogger(): pino.Logger {
  return pino(baseOptions(), pinoPretty({
    messageFormat: '{msg}',
    ignore: 'pid,hostname,time,level',
    colorize: false,
  }));
}
