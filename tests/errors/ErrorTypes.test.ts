import { describe, it, expect } from 'vitest';
import {
  TimeoutError,
  AuthenticationError,
  NetworkError,
  TwoFactorAuthError,
  ShutdownError,
  BankScrapingError,
  ConfigurationError
} from '../../src/errors/ErrorTypes.js';

describe('ErrorTypes', () => {
  describe('TimeoutError', () => {
    it('has correct name and message', () => {
      const error = new TimeoutError('Scraping discount', 600000);
      expect(error.name).toBe('TimeoutError');
      expect(error.message).toBe('Scraping discount timed out after 600s');
      expect(error).toBeInstanceOf(Error);
    });

    it('formats milliseconds to seconds correctly', () => {
      const error = new TimeoutError('test', 5000);
      expect(error.message).toContain('5s');
    });
  });

  describe('AuthenticationError', () => {
    it('has correct name and message', () => {
      const error = new AuthenticationError('Invalid credentials');
      expect(error.name).toBe('AuthenticationError');
      expect(error.message).toBe('Invalid credentials');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('NetworkError', () => {
    it('has correct name and message', () => {
      const error = new NetworkError('Connection refused');
      expect(error.name).toBe('NetworkError');
      expect(error.message).toBe('Connection refused');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('TwoFactorAuthError', () => {
    it('has correct name and message', () => {
      const error = new TwoFactorAuthError('SMS not received');
      expect(error.name).toBe('TwoFactorAuthError');
      expect(error.message).toBe('SMS not received');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('ShutdownError', () => {
    it('has correct name and default message', () => {
      const error = new ShutdownError();
      expect(error.name).toBe('ShutdownError');
      expect(error.message).toBe('Operation cancelled due to shutdown');
      expect(error).toBeInstanceOf(Error);
    });

    it('accepts custom message', () => {
      const error = new ShutdownError('Custom shutdown reason');
      expect(error.message).toBe('Custom shutdown reason');
    });
  });

  describe('BankScrapingError', () => {
    it('has correct name and includes bank name', () => {
      const error = new BankScrapingError('discount', 'Login failed');
      expect(error.name).toBe('BankScrapingError');
      expect(error.message).toBe('Failed to scrape discount: Login failed');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('ConfigurationError', () => {
    it('has correct name and message', () => {
      const error = new ConfigurationError('Missing password');
      expect(error.name).toBe('ConfigurationError');
      expect(error.message).toBe('Missing password');
      expect(error).toBeInstanceOf(Error);
    });
  });
});
