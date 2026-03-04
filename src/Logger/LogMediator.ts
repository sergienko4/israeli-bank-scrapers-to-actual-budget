/**
 * Fan-out mediator that routes each log call to all registered ILogger targets.
 * Mirrors the NotificationService pattern (multiple INotifier targets).
 */
import type { ILogger, LogContext } from './ILogger.js';

export class LogMediator implements ILogger {
  constructor(private readonly targets: ILogger[]) {}

  debug(message: string, context?: LogContext): void {
    this.targets.forEach(t => t.debug(message, context));
  }

  info(message: string, context?: LogContext): void {
    this.targets.forEach(t => t.info(message, context));
  }

  warn(message: string, context?: LogContext): void {
    this.targets.forEach(t => t.warn(message, context));
  }

  error(message: string, context?: LogContext): void {
    this.targets.forEach(t => t.error(message, context));
  }
}
