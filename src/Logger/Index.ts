/**
 * Logger singleton factory with format dispatch and optional file output.
 * Entry points call createLogger(), all modules call getLogger().
 * When logDir is set: LogMediator fans out to PinoAdapter (stdout) + FileLogger (file).
 */

import type { ILogConfig, LogFormat, MessageFormat } from '../Types/Index.js';
import { isFail } from '../Types/Index.js';
import FileLogger from './FileLogger.js';
import type { ILogger } from './ILogger.js';
import LogBuffer from './LogBuffer.js';
import cleanOldLogs from './LogCleanup.js';
import LogMediator from './LogMediator.js';
import PinoAdapter from './PinoAdapter.js';
import createPinoInstance from './PinoTransports.js';

const FORMAT_MAP: Record<MessageFormat, LogFormat> = {
  summary: 'words',
  compact: 'table',
  ledger:  'json',
  emoji:   'words',
};

/**
 * Derives the pino LogFormat from the user-facing message format and bot mode.
 * @param messageFormat - Optional user-configured message format.
 * @param listenForCommands - When true, forces phone format for bot output.
 * @returns The resolved LogFormat to use for the logger instance.
 */
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

/**
 * Initialises and returns the global logger instance.
 * @param config - Optional log configuration (format, logDir).
 * @returns The configured ILogger instance (stdout only or stdout + file).
 */
export function createLogger(config?: ILogConfig): ILogger {
  const format: LogFormat = config?.format ?? 'words';
  bufferInstance = new LogBuffer(0); // buffer deprecated; kept for backward compat
  const stdout = new PinoAdapter(createPinoInstance(format), format);
  if (config?.logDir) {
    const cleanupResult = cleanOldLogs(config.logDir);
    if (isFail(cleanupResult)) {
      stdout.warn(`Log cleanup failed: ${cleanupResult.message}`);
    }
    try {
      instance = new LogMediator([stdout, new FileLogger(config.logDir)]);
    } catch {
      // Log dir not writable (e.g. Docker node user, read-only fs) — stdout only
      stdout.warn(`Log files unavailable (${config.logDir}), using stdout only`);
      instance = stdout;
    }
  } else {
    instance = stdout;
  }
  return instance;
}

/**
 * Returns the active global logger, creating a default instance if needed.
 * @returns The current ILogger singleton.
 */
export function getLogger(): ILogger {
  if (!instance) return createLogger();
  return instance;
}

/**
 * Returns the global LogBuffer instance used by the bot's /logs command.
 * @returns The current LogBuffer singleton.
 */
export function getLogBuffer(): LogBuffer {
  return bufferInstance;
}

export { default as FileLogger } from './FileLogger.js';
export { ILogger, LogContext, LogLevel } from './ILogger.js';
export { default as LogBuffer } from './LogBuffer.js';
export { default as LogFileReader } from './LogFileReader.js';
export { default as LogMediator } from './LogMediator.js';
export { default as PinoAdapter } from './PinoAdapter.js';
