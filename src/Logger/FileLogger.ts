/**
 * ILogger implementation that writes raw NDJSON to a rotating log file.
 * Uses its own pino instance (no pino-pretty) so files are always parseable.
 */
import pino from 'pino';
import type { ILogger, LogContext } from './ILogger.js';
import { LogRotatingStream } from './LogRotatingStream.js';
import { baseOptions } from './LoggerOptions.js';

const EMPTY: LogContext = {};

export class FileLogger implements ILogger {
  private readonly pinoLogger: pino.Logger;

  constructor(logDir: string) {
    this.pinoLogger = pino(baseOptions(), new LogRotatingStream(logDir));
  }

  debug(message: string, context?: LogContext): void {
    this.pinoLogger.debug(context ?? EMPTY, message);
  }

  info(message: string, context?: LogContext): void {
    this.pinoLogger.info(context ?? EMPTY, message);
  }

  warn(message: string, context?: LogContext): void {
    this.pinoLogger.warn(context ?? EMPTY, message);
  }

  error(message: string, context?: LogContext): void {
    this.pinoLogger.error(context ?? EMPTY, message);
  }
}
