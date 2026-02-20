/**
 * Console logger — preserves current emoji output (words format)
 * Default logger for development and human-readable output
 */

import { ILogger, LogLevel, LogContext } from './ILogger.js';
import { LogBuffer } from './LogBuffer.js';

const writerKeys: Record<LogLevel, 'debug' | 'log' | 'warn' | 'error'> = {
  debug: 'debug',
  info: 'log',
  warn: 'warn',
  error: 'error',
};

export class ConsoleLogger implements ILogger {
  constructor(private buffer: LogBuffer) {}

  debug(message: string, _context?: LogContext): void {
    this.write('debug', message);
  }

  info(message: string, _context?: LogContext): void {
    this.write('info', message);
  }

  warn(message: string, _context?: LogContext): void {
    this.write('warn', message);
  }

  error(message: string, _context?: LogContext): void {
    this.write('error', message);
  }

  private write(level: LogLevel, message: string): void {
    console[writerKeys[level]](message);
    this.buffer.add(message);
  }
}
