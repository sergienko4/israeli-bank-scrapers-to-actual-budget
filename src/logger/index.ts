/**
 * Logger singleton factory with format dispatch
 * Entry points call createLogger(), all modules call getLogger()
 */

import { ILogger } from './ILogger.js';
import { LogBuffer } from './LogBuffer.js';
import { ConsoleLogger } from './ConsoleLogger.js';
import { JsonLogger } from './JsonLogger.js';
import { TableLogger } from './TableLogger.js';
import { PhoneLogger } from './PhoneLogger.js';
import { LogConfig, LogFormat } from '../types/index.js';

const loggerFactories: Record<LogFormat, (buf: LogBuffer) => ILogger> = {
  words: (buf) => new ConsoleLogger(buf),
  json: (buf) => new JsonLogger(buf),
  table: (buf) => new TableLogger(buf),
  phone: (buf) => new PhoneLogger(buf),
};

let instance: ILogger | null = null;
let bufferInstance: LogBuffer | null = null;

export function createLogger(config?: LogConfig): ILogger {
  const format: LogFormat = config?.format ?? 'words';
  bufferInstance = new LogBuffer(config?.maxBufferSize);
  const factory = loggerFactories[format] ?? loggerFactories.words;
  instance = factory(bufferInstance);
  return instance;
}

export function getLogger(): ILogger {
  if (!instance) return createLogger();
  return instance;
}

export function getLogBuffer(): LogBuffer {
  if (!bufferInstance) bufferInstance = new LogBuffer();
  return bufferInstance;
}

export { ILogger, LogContext, LogLevel } from './ILogger.js';
export { LogBuffer } from './LogBuffer.js';
export { ConsoleLogger } from './ConsoleLogger.js';
export { JsonLogger } from './JsonLogger.js';
export { TableLogger } from './TableLogger.js';
export { PhoneLogger } from './PhoneLogger.js';
