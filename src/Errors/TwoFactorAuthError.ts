/** Thrown when two-factor authentication fails or is not completed. */
export class TwoFactorAuthError extends Error {
  /**
   * Creates a TwoFactorAuthError.
   * @param message - Description of the 2FA failure.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TwoFactorAuthError';
  }
}
