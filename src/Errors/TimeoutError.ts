/** Thrown when an operation exceeds its allotted time budget. */
export class TimeoutError extends Error {
  /**
   * Creates a TimeoutError.
   * @param operation - Name of the timed-out operation.
   * @param timeoutMs - Timeout duration in milliseconds.
   */
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs / 1000}s`);
    this.name = 'TimeoutError';
  }
}
