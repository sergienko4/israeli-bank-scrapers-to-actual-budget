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
  /**
   * Wraps a promise with a deadline, rejecting if the deadline is exceeded.
   * @param promise - The async operation to time-box.
   * @param timeoutMs - Maximum allowed duration in milliseconds.
   * @param operationName - Label used in the TimeoutError message.
   * @returns The resolved value of the original promise if it completes in time.
   */
  wrap<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new TimeoutError(operationName, timeoutMs));
      }, timeoutMs);

      // Clean up timer if the original promise resolves
      void promise.finally(() => clearTimeout(timer));
    });

    return Promise.race([promise, timeoutPromise]);
  }
}
