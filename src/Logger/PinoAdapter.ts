/**
 * pino-backed ILogger implementation for stdout output.
 * Phone format strips emojis before passing to pino so stdout stays compact.
 */
import type pino from 'pino';

import type { LogFormat } from '../Types/Index.js';
import type { ILogger, LogContext } from './ILogger.js';

const EMOJI_RE = /\p{Extended_Pictographic}(?:\u200D\p{Extended_Pictographic})*/gu;
const EMPTY: LogContext = {};

/**
 * Removes emoji characters and collapses extra whitespace from a string.
 * @param text - Input string that may contain emojis.
 * @returns Clean string with emojis removed and whitespace normalised.
 */
function stripEmojis(text: string): string {
  return text.replaceAll(EMOJI_RE, '').replaceAll(/\s{2,}/g, ' ').trim();
}

/** pino-backed ILogger implementation for stdout output. */
export default class PinoAdapter implements ILogger {
  private readonly _pinoInstance: pino.Logger;
  private readonly _isPhone: boolean;

  /**
   * Creates a PinoAdapter wrapping an existing pino instance.
   * @param pinoInstance - The configured pino logger to delegate to.
   * @param format - Log format; 'phone' enables emoji-stripping and prefix markers.
   */
  constructor(pinoInstance: pino.Logger, format: LogFormat) {
    this._pinoInstance = pinoInstance;
    this._isPhone = format === 'phone';
  }

  /**
   * Logs a debug-level message.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  public debug(message: string, context?: LogContext): void {
    const prepared = this.prepare(message, 'debug');
    this._pinoInstance.debug(context ?? EMPTY, prepared);
  }

  /**
   * Logs an info-level message.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  public info(message: string, context?: LogContext): void {
    const prepared = this.prepare(message, 'info');
    this._pinoInstance.info(context ?? EMPTY, prepared);
  }

  /**
   * Logs a warning-level message.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  public warn(message: string, context?: LogContext): void {
    const prepared = this.prepare(message, 'warn');
    this._pinoInstance.warn(context ?? EMPTY, prepared);
  }

  /**
   * Logs an error-level message.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  public error(message: string, context?: LogContext): void {
    const prepared = this.prepare(message, 'error');
    this._pinoInstance.error(context ?? EMPTY, prepared);
  }

  /**
   * Prepares a message for output, stripping emojis and adding prefix in phone mode.
   * @param message - Raw message text.
   * @param level - Log level used to choose the prefix in phone mode.
   * @returns Processed message string ready for pino.
   */
  private prepare(message: string, level: 'debug' | 'info' | 'warn' | 'error'): string {
    if (!this._isPhone) return message;
    const clean = stripEmojis(message);
    return level === 'error' ? `! ${clean}` : `> ${clean}`;
  }
}
