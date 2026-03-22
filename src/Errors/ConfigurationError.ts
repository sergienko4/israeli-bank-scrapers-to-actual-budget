/** Thrown when the application configuration is invalid or missing required fields. */
export default class ConfigurationError extends Error {
  /**
   * Creates a ConfigurationError.
   * @param message - Description of the configuration problem.
   */
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}
