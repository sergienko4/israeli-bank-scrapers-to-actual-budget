/**
 * ILogger implementation that writes raw NDJSON to a rotating log file.
 * Uses its own pino instance (no pino-pretty) so files are always parseable.
 */
import pino from 'pino';

import type { ILogger, LogContext } from './ILogger.js';
import { baseOptions } from './LoggerOptions.js';
import LogRotatingStream from './LogRotatingStream.js';

const EMPTY: LogContext = {};

/** ILogger implementation that writes NDJSON log entries to a rotating file. */
export default class FileLogger implements ILogger {
  private readonly _pinoLogger: pino.Logger;

  /**
   * Creates a FileLogger writing to the given directory.
   * @param logDir - Absolute path to the directory where log files are written.
   */
  constructor(logDir: string) {
    const options = baseOptions();
    this._pinoLogger = pino(options, new LogRotatingStream(logDir));
  }

  /**
   * Logs a debug-level message.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  public debug(message: string, context?: LogContext): void {
    this._pinoLogger.debug(context ?? EMPTY, message);
  }

  /**
   * Logs an info-level message.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  public info(message: string, context?: LogContext): void {
    this._pinoLogger.info(context ?? EMPTY, message);
  }

  /**
   * Logs a warning-level message.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  public warn(message: string, context?: LogContext): void {
    this._pinoLogger.warn(context ?? EMPTY, message);
  }

  /**
   * Logs an error-level message.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  public error(message: string, context?: LogContext): void {
    this._pinoLogger.error(context ?? EMPTY, message);
  }
}
