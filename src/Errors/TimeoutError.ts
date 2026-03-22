/** Thrown when an operation exceeds its allotted time budget. */
export default class TimeoutError extends Error {
  /**
   * Creates a TimeoutError.
   * @param operation - Name of the timed-out operation.
   * @param timeoutMs - Timeout duration in milliseconds.
   */
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${String(timeoutMs / 1000)}s`);
    this.name = 'TimeoutError';
  }
}
