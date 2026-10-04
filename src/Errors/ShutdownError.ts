/** Thrown when an operation is cancelled because the process is shutting down. */
export default class ShutdownError extends Error {
  /**
   * Creates a ShutdownError.
   * @param message - Optional override for the cancellation reason.
   * @param options - Optional cause, such as the last error of an exhausted retry loop.
   */
  constructor(message = 'Operation cancelled due to shutdown', options?: ErrorOptions) {
    super(message, options);
    this.name = 'ShutdownError';
  }
}
