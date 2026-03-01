/**
 * pino instance factory — one instance per LogFormat.
 * Uses pino-pretty as a synchronous transform stream (no worker threads).
 */
import pino from 'pino';
import pinoPretty from 'pino-pretty';
import { LogFormat } from '../Types/index.js';
import { baseOptions } from './LoggerOptions.js';

const transportFactories: Record<LogFormat, () => pino.Logger> = {
  words: createWordsLogger,
  json: createJsonLogger,
  table: createTableLogger,
  phone: createPhoneLogger,
};

export function createPinoInstance(format: LogFormat): pino.Logger {
  const factory = transportFactories[format] ?? transportFactories.words;
  return factory();
}

function createWordsLogger(): pino.Logger {
  return pino(baseOptions(), pinoPretty({ colorize: true }));
}

function createJsonLogger(): pino.Logger {
  return pino(baseOptions());
}

function createTableLogger(): pino.Logger {
  return pino(baseOptions(), pinoPretty({ colorize: false, ignore: 'pid,hostname' }));
}

function createPhoneLogger(): pino.Logger {
  return pino(baseOptions(), pinoPretty({
    messageFormat: '{msg}',
    ignore: 'pid,hostname,time,level',
    colorize: false,
  }));
}
