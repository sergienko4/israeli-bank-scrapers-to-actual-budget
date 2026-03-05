/**
 * pino-backed ILogger implementation for stdout output.
 * Phone format strips emojis before passing to pino so stdout stays compact.
 */
import type pino from 'pino';
import type { ILogger, LogContext } from './ILogger.js';
import type { LogFormat } from '../Types/Index.js';

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE00}|\u{FE0F}|\u{200D}/gu;
const EMPTY: LogContext = {};

/**
 * Removes emoji characters and collapses extra whitespace from a string.
 * @param text - Input string that may contain emojis.
 * @returns Clean string with emojis removed and whitespace normalised.
 */
function stripEmojis(text: string): string {
  return text.replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();
}

/** pino-backed ILogger implementation for stdout output. */
export class PinoAdapter implements ILogger {
  private readonly pinoInstance: pino.Logger;
  private readonly isPhone: boolean;

  /**
   * Creates a PinoAdapter wrapping an existing pino instance.
   * @param pinoInstance - The configured pino logger to delegate to.
   * @param format - Log format; 'phone' enables emoji-stripping and prefix markers.
   */
  constructor(pinoInstance: pino.Logger, format: LogFormat) {
    this.pinoInstance = pinoInstance;
    this.isPhone = format === 'phone';
  }

  /**
   * Logs a debug-level message.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  debug(message: string, context?: LogContext): void {
    this.pinoInstance.debug(context ?? EMPTY, this.prepare(message, 'debug'));
  }

  /**
   * Logs an info-level message.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  info(message: string, context?: LogContext): void {
    this.pinoInstance.info(context ?? EMPTY, this.prepare(message, 'info'));
  }

  /**
   * Logs a warning-level message.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  warn(message: string, context?: LogContext): void {
    this.pinoInstance.warn(context ?? EMPTY, this.prepare(message, 'warn'));
  }

  /**
   * Logs an error-level message.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  error(message: string, context?: LogContext): void {
    this.pinoInstance.error(context ?? EMPTY, this.prepare(message, 'error'));
  }

  /**
   * Prepares a message for output, stripping emojis and adding prefix in phone mode.
   * @param message - Raw message text.
   * @param level - Log level used to choose the prefix in phone mode.
   * @returns Processed message string ready for pino.
   */
  private prepare(message: string, level: 'debug' | 'info' | 'warn' | 'error'): string {
    if (!this.isPhone) return message;
    const clean = stripEmojis(message);
    return level === 'error' ? `! ${clean}` : `> ${clean}`;
  }
}
