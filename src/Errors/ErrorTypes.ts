/**
 * Custom error types for better error handling and categorization
 * Single module for all domain error classes — error type collections are
 * a legitimate exception to the one-class-per-file rule.
 */
/* eslint-disable max-classes-per-file */

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

/** Thrown when a bank scraping attempt fails. */
export class BankScrapingError extends Error {
  /**
   * Creates a BankScrapingError.
   * @param bankName - Name of the bank that failed to scrape.
   * @param message - Description of the scraping failure.
   */
  constructor(bankName: string, message: string) {
    super(`Failed to scrape ${bankName}: ${message}`);
    this.name = 'BankScrapingError';
  }
}

/** Thrown when the application configuration is invalid or missing required fields. */
export class ConfigurationError extends Error {
  /**
   * Creates a ConfigurationError.
   * @param message - Description of the configuration problem.
   */
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}
