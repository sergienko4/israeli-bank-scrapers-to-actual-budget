/**
 * Table logger — timestamped columns: [HH:MM:SS] LEVEL message
 * Clean structured output with timestamps
 */

import { ILogger, LogLevel, LogContext } from './ILogger.js';
import { LogBuffer } from './LogBuffer.js';

const levelLabels: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

export class TableLogger implements ILogger {
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
    const line = `[${this.timestamp()}] ${levelLabels[level]} ${message}`;
    const writer = level === 'error' ? console.error : console.log;
    writer(line);
    this.buffer.add(line);
  }

  private timestamp(): string {
    return new Date().toTimeString().slice(0, 8);
  }
}
