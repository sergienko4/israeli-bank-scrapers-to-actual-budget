/**
 * Logger singleton factory with format dispatch and optional file output.
 * Entry points call createLogger(), all modules call getLogger().
 * When logDir is set: LogMediator fans out to PinoAdapter (stdout) + FileLogger (file).
 */

import { ILogger } from './ILogger.js';
import { LogBuffer } from './LogBuffer.js';
import { PinoAdapter } from './PinoAdapter.js';
import { createPinoInstance } from './PinoTransports.js';
import { FileLogger } from './FileLogger.js';
import { LogMediator } from './LogMediator.js';
import { cleanOldLogs } from './LogCleanup.js';
import { LogConfig, LogFormat, MessageFormat } from '../Types/index.js';

const FORMAT_MAP: Record<MessageFormat, LogFormat> = {
  summary: 'words',
  compact: 'table',
  ledger:  'json',
  emoji:   'words',
};

export function deriveLogFormat(
  messageFormat?: MessageFormat,
  listenForCommands?: boolean
): LogFormat {
  if (listenForCommands) return 'phone';
  // FORMAT_MAP fully covers all MessageFormat values — no fallback needed
  return messageFormat ? FORMAT_MAP[messageFormat] : 'words';
}

let instance: ILogger | null = null;
// Initialised eagerly so getLogBuffer() never needs a conditional
let bufferInstance: LogBuffer = new LogBuffer(0);

export function createLogger(config?: LogConfig): ILogger {
  const format: LogFormat = config?.format ?? 'words';
  bufferInstance = new LogBuffer(0); // buffer deprecated; kept for backward compat
  const stdout = new PinoAdapter(createPinoInstance(format), format);
  if (config?.logDir) {
    cleanOldLogs(config.logDir);
    instance = new LogMediator([stdout, new FileLogger(config.logDir)]);
  } else {
    instance = stdout;
  }
  return instance;
}

export function getLogger(): ILogger {
  if (!instance) return createLogger();
  return instance;
}

export function getLogBuffer(): LogBuffer {
  return bufferInstance;
}

export { ILogger, LogContext, LogLevel } from './ILogger.js';
export { LogBuffer } from './LogBuffer.js';
export { PinoAdapter } from './PinoAdapter.js';
export { LogMediator } from './LogMediator.js';
export { FileLogger } from './FileLogger.js';
export { LogFileReader } from './LogFileReader.js';
