/**
 * Fan-out mediator that routes each log call to all registered ILogger targets.
 * Mirrors the NotificationService pattern (multiple INotifier targets).
 */
import type { ILogger, LogContext } from './ILogger.js';

/** Fan-out mediator that routes each log call to all registered ILogger targets. */
export class LogMediator implements ILogger {
  /**
   * Creates a LogMediator that broadcasts to the provided targets.
   * @param targets - Array of ILogger implementations to receive every log call.
   */
  constructor(private readonly targets: ILogger[]) {}

  /**
   * Broadcasts a debug-level message to all targets.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  debug(message: string, context?: LogContext): void {
    this.targets.forEach(t => t.debug(message, context));
  }

  /**
   * Broadcasts an info-level message to all targets.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  info(message: string, context?: LogContext): void {
    this.targets.forEach(t => t.info(message, context));
  }

  /**
   * Broadcasts a warning-level message to all targets.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  warn(message: string, context?: LogContext): void {
    this.targets.forEach(t => t.warn(message, context));
  }

  /**
   * Broadcasts an error-level message to all targets.
   * @param message - The message text.
   * @param context - Optional structured key-value context.
   */
  error(message: string, context?: LogContext): void {
    this.targets.forEach(t => t.error(message, context));
  }
}
