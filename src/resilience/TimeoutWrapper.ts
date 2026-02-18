/**
 * Timeout wrapper for promises
 * Follows Single Responsibility Principle: Only handles timeout logic
 */

import { TimeoutError } from '../errors/ErrorTypes.js';

export interface ITimeoutWrapper {
  wrap<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T>;
}

export class TimeoutWrapper implements ITimeoutWrapper {
  wrap<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new TimeoutError(operationName, timeoutMs));
      }, timeoutMs);

      // Clean up timer if the original promise resolves
      promise.finally(() => clearTimeout(timer));
    });

    return Promise.race([promise, timeoutPromise]);
  }
}
