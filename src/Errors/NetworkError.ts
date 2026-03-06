/** Thrown when a network request fails due to connectivity issues. */
export class NetworkError extends Error {
  /**
   * Creates a NetworkError.
   * @param message - Description of the network failure.
   */
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}
