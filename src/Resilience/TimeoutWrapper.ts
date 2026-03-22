/**
 * Timeout wrapper for promises
 * Follows Single Responsibility Principle: Only handles timeout logic
 */

import { TimeoutError } from '../Errors/ErrorTypes.js';

export interface ITimeoutWrapper {
  wrap<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T>;
}

/** Races a promise against a timeout, rejecting with TimeoutError if exceeded. */
export class TimeoutWrapper implements ITimeoutWrapper {
  private readonly _errorFactory = TimeoutError;

  /**
   * Wraps a promise with a deadline, rejecting if the deadline is exceeded.
   * @param promise - The async operation to time-box.
   * @param timeoutMs - Maximum allowed duration in milliseconds.
   * @param operationName - Label used in the TimeoutError message.
   * @returns The resolved value of the original promise if it completes in time.
   */
  public wrap<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      const delay = timeoutMs;
      const timer = globalThis.setTimeout(() => {
        reject(new this._errorFactory(operationName, delay));
      }, delay);
      void promise.finally(() => { clearTimeout(timer); });
    });

    return Promise.race([promise, timeoutPromise]);
  }
}
