/**
 * Factory functions and type guards for the Procedure result pattern.
 * Use succeed() / fail() to create results, isSuccess() / isFail() to narrow.
 */

import type { IProcedureFailure, IProcedureSuccess, Procedure } from './Procedure.js';

/**
 * Creates a successful Procedure result.
 * @param data - The success payload.
 * @param status - Optional status label (defaults to 'ok').
 * @returns A frozen IProcedureSuccess object.
 */
export function succeed<T>(data: T, status = 'ok'): IProcedureSuccess<T> {
  return Object.freeze({ success: true as const, status, data });
}

/** Options for creating a failure result. */
export interface IFailOptions {
  status?: string;
  error?: Error;
}

/**
 * Creates a failed Procedure result.
 * @param message - Human-readable failure description.
 * @param opts - Optional status label and original Error.
 * @returns A frozen IProcedureFailure object.
 */
export function fail(message: string, opts: IFailOptions = {}): IProcedureFailure {
  const status = opts.status ?? 'error';
  const result: IProcedureFailure = opts.error
    ? { success: false as const, status, message, error: opts.error }
    : { success: false as const, status, message };
  return Object.freeze(result);
}

/**
 * Wraps an async operation in a Procedure, catching any thrown error.
 * @param promise - The async operation to wrap.
 * @param failMessage - Message to use if the operation throws.
 * @returns A Procedure containing either the resolved value or a failure.
 */
export async function fromPromise<T>(
  promise: Promise<T>, failMessage: string
): Promise<Procedure<T>> {
  try {
    const data = await promise;
    return succeed(data);
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return fail(failMessage, { error });
  }
}

/**
 * Type guard: narrows Procedure<T> to IProcedureSuccess<T>.
 * @param result - The Procedure to check.
 * @returns True if the result is a success.
 */
export function isSuccess<T>(result: Procedure<T>): result is IProcedureSuccess<T> {
  return result.success;
}

/**
 * Type guard: narrows Procedure<T> to IProcedureFailure.
 * @param result - The Procedure to check.
 * @returns True if the result is a failure.
 */
export function isFail<T>(result: Procedure<T>): result is IProcedureFailure {
  return !result.success;
}
