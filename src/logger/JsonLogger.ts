/**
 * JSON logger — structured JSON output, one object per line
 * For Docker log aggregators (Loki, ELK, CloudWatch)
 */

import { ILogger, LogLevel, LogContext } from './ILogger.js';
import { LogBuffer } from './LogBuffer.js';

export interface JsonLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

export class JsonLogger implements ILogger {
  constructor(private buffer: LogBuffer) {}

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    const line = this.safeStringify(this.buildEntry(level, message, context));
    const writer = level === 'error' ? console.error : console.log;
    writer(line);
    this.buffer.add(line);
  }

  private safeStringify(entry: JsonLogEntry): string {
    try { return JSON.stringify(entry); }
    catch { return JSON.stringify({ timestamp: entry.timestamp, level: entry.level, message: entry.message }); }
  }

  private buildEntry(level: LogLevel, message: string, context?: LogContext): JsonLogEntry {
    return { ...context, timestamp: new Date().toISOString(), level, message };
  }
}
