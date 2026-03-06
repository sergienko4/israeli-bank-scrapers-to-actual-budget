/** Thrown when an operation is cancelled because the process is shutting down. */
export class ShutdownError extends Error {
  /**
   * Creates a ShutdownError.
   * @param message - Optional override for the cancellation reason.
   */
  constructor(message: string = 'Operation cancelled due to shutdown') {
    super(message);
    this.name = 'ShutdownError';
  }
}
