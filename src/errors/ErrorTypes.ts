/**
 * Custom error types for better error handling and categorization
 */

export class TimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs / 1000}s`);
    this.name = 'TimeoutError';
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class TwoFactorAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TwoFactorAuthError';
  }
}

export class ShutdownError extends Error {
  constructor(message: string = 'Operation cancelled due to shutdown') {
    super(message);
    this.name = 'ShutdownError';
  }
}

export class BankScrapingError extends Error {
  constructor(bankName: string, message: string) {
    super(`Failed to scrape ${bankName}: ${message}`);
    this.name = 'BankScrapingError';
  }
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}
