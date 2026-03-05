/**
 * ILogger implementation that writes raw NDJSON to a rotating log file.
 * Uses its own pino instance (no pino-pretty) so files are always parseable.
 */
import pino from 'pino';
import type { ILogger, LogContext } from './ILogger.js';
import { LogRotatingStream } from './LogRotatingStream.js';
import { baseOptions } from './LoggerOptions.js';

const EMPTY: LogContext = {};

/** ILogger implementation that writes NDJSON log entries to a rotating file. */
export class FileLogger implements ILogger {
  private readonly pinoLogger: pino.Logger;

  /**
   * Creates a FileLogger writing to the given directory.
   * @param logDir - Absolute path to the directory where log files are written.
   */
  constructor(logDir: string) {
    this.pinoLogger = pino(baseOptions(), new LogRotatingStream(logDir));
  }

  /**
   * Logs a debug-level message.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  debug(message: string, context?: LogContext): void {
    this.pinoLogger.debug(context ?? EMPTY, message);
  }

  /**
   * Logs an info-level message.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  info(message: string, context?: LogContext): void {
    this.pinoLogger.info(context ?? EMPTY, message);
  }

  /**
   * Logs a warning-level message.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  warn(message: string, context?: LogContext): void {
    this.pinoLogger.warn(context ?? EMPTY, message);
  }

  /**
   * Logs an error-level message.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  error(message: string, context?: LogContext): void {
    this.pinoLogger.error(context ?? EMPTY, message);
  }
}
