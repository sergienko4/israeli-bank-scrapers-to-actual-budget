/**
 * pino-backed ILogger implementation for stdout output.
 * Phone format strips emojis before passing to pino so stdout stays compact.
 */
import type pino from 'pino';
import type { ILogger, LogContext } from './ILogger.js';
import type { LogFormat } from '../Types/Index.js';

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE00}|\u{FE0F}|\u{200D}/gu;
const EMPTY: LogContext = {};

function stripEmojis(text: string): string {
  return text.replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();
}

export class PinoAdapter implements ILogger {
  private readonly pinoInstance: pino.Logger;
  private readonly isPhone: boolean;

  constructor(pinoInstance: pino.Logger, format: LogFormat) {
    this.pinoInstance = pinoInstance;
    this.isPhone = format === 'phone';
  }

  debug(message: string, context?: LogContext): void {
    this.pinoInstance.debug(context ?? EMPTY, this.prepare(message, 'debug'));
  }

  info(message: string, context?: LogContext): void {
    this.pinoInstance.info(context ?? EMPTY, this.prepare(message, 'info'));
  }

  warn(message: string, context?: LogContext): void {
    this.pinoInstance.warn(context ?? EMPTY, this.prepare(message, 'warn'));
  }

  error(message: string, context?: LogContext): void {
    this.pinoInstance.error(context ?? EMPTY, this.prepare(message, 'error'));
  }

  private prepare(message: string, level: 'debug' | 'info' | 'warn' | 'error'): string {
    if (!this.isPhone) return message;
    const clean = stripEmojis(message);
    return level === 'error' ? `! ${clean}` : `> ${clean}`;
  }
}
