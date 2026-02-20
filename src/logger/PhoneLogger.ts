/**
 * Phone logger — ultra-compact format for mobile viewing
 * Strips emojis, uses > prefix, minimal output
 */

import { ILogger, LogLevel, LogContext } from './ILogger.js';
import { LogBuffer } from './LogBuffer.js';

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]+/gu;

function stripEmojis(text: string): string {
  return text.replace(EMOJI_PATTERN, '').replace(/\s{2,}/g, ' ').trim();
}

export class PhoneLogger implements ILogger {
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
    const prefix = level === 'error' ? '! ' : '> ';
    const line = `${prefix}${stripEmojis(message)}`;
    const writer = level === 'error' ? console.error : console.log;
    writer(line);
    this.buffer.add(line);
  }
}
