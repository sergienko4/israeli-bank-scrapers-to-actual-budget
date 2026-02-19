import { describe, it, expect } from 'vitest';
import { ErrorFormatter } from '../../src/errors/ErrorFormatter.js';
import {
  TimeoutError,
  AuthenticationError,
  NetworkError,
  TwoFactorAuthError,
  ShutdownError,
  BankScrapingError,
  ConfigurationError
} from '../../src/errors/ErrorTypes.js';

describe('ErrorFormatter', () => {
  const formatter = new ErrorFormatter();

  describe('format with known error types', () => {
    it('formats TimeoutError', () => {
      const error = new TimeoutError('Scraping discount', 600000);
      const result = formatter.format(error);
      expect(result).toContain('Timeout Error');
      expect(result).toContain('bank\'s website may be slow');
    });

    it('formats AuthenticationError', () => {
      const error = new AuthenticationError('Bad credentials');
      const result = formatter.format(error);
      expect(result).toContain('Authentication Error');
      expect(result).toContain('verify your credentials');
    });

    it('formats NetworkError', () => {
      const error = new NetworkError('ECONNREFUSED');
      const result = formatter.format(error);
      expect(result).toContain('Network Error');
      expect(result).toContain('internet connection');
    });

    it('formats TwoFactorAuthError', () => {
      const error = new TwoFactorAuthError('OTP expired');
      const result = formatter.format(error);
      expect(result).toContain('2FA Error');
      expect(result).toContain('2FA device');
    });

    it('formats ShutdownError', () => {
      const error = new ShutdownError();
      const result = formatter.format(error);
      expect(result).toContain('Operation Cancelled');
    });

    it('formats BankScrapingError', () => {
      const error = new BankScrapingError('leumi', 'Page not found');
      const result = formatter.format(error);
      expect(result).toContain('Bank Scraping Error');
    });

    it('formats ConfigurationError', () => {
      const error = new ConfigurationError('Missing syncId');
      const result = formatter.format(error);
      expect(result).toContain('Configuration Error');
    });
  });

  describe('format with context', () => {
    it('includes context string when provided', () => {
      const error = new AuthenticationError('Bad password');
      const result = formatter.format(error, 'discount');
      expect(result).toContain('(discount)');
    });

    it('excludes context when empty', () => {
      const error = new AuthenticationError('Bad password');
      const result = formatter.format(error);
      expect(result).not.toContain('()');
    });
  });

  describe('categorizeByMessage fallback', () => {
    it('detects credentials in message', () => {
      const error = new Error('Invalid credentials provided');
      const result = formatter.format(error);
      expect(result).toContain('Authentication Error');
    });

    it('detects login in message', () => {
      const error = new Error('login failed');
      const result = formatter.format(error);
      expect(result).toContain('Authentication Error');
    });

    it('detects ECONNREFUSED in message', () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1');
      const result = formatter.format(error);
      expect(result).toContain('Network Error');
    });

    it('detects ENOTFOUND in message', () => {
      const error = new Error('getaddrinfo ENOTFOUND example.com');
      const result = formatter.format(error);
      expect(result).toContain('Network Error');
    });

    it('detects 2FA in message', () => {
      const error = new Error('2FA verification required');
      const result = formatter.format(error);
      expect(result).toContain('2FA Error');
    });

    it('detects OTP in message', () => {
      const error = new Error('OTP expired');
      const result = formatter.format(error);
      expect(result).toContain('2FA Error');
    });

    it('returns default format for unknown errors', () => {
      const error = new Error('Something unexpected');
      const result = formatter.format(error);
      expect(result).toContain('Error');
      expect(result).toContain('Something unexpected');
    });

    it('handles error with no message', () => {
      const error = new Error();
      const result = formatter.format(error);
      expect(result).toContain('Error');
    });
  });
});
