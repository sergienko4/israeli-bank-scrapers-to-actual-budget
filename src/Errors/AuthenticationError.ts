/** Thrown when bank credentials are rejected or login fails. */
export class AuthenticationError extends Error {
  /**
   * Creates an AuthenticationError.
   * @param message - Description of the authentication failure.
   */
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}
