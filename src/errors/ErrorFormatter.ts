/**
 * Error formatter for user-friendly error messages
 * Follows Open/Closed Principle: Easy to add new error formats without modifying existing code
 */

import {
  TimeoutError,
  AuthenticationError,
  NetworkError,
  TwoFactorAuthError,
  ShutdownError,
  BankScrapingError,
  ConfigurationError
} from './ErrorTypes.js';

export interface IErrorFormatter {
  format(error: Error, context?: string): string;
}

export class ErrorFormatter implements IErrorFormatter {
  format(error: Error, context: string = ''): string {
    const contextStr = context ? ` (${context})` : '';

    if (error instanceof TimeoutError) {
      return `⏱️  Timeout Error${contextStr}: ${error.message}. The bank's website may be slow or unresponsive.`;
    }

    if (error instanceof AuthenticationError) {
      return `🔐 Authentication Error${contextStr}: ${error.message}. Please verify your credentials.`;
    }

    if (error instanceof NetworkError) {
      return `🌐 Network Error${contextStr}: ${error.message}. Check your internet connection.`;
    }

    if (error instanceof TwoFactorAuthError) {
      return `📱 2FA Error${contextStr}: ${error.message}. Check your 2FA device or SMS.`;
    }

    if (error instanceof ShutdownError) {
      return `🛑 Operation Cancelled${contextStr}: ${error.message}`;
    }

    if (error instanceof BankScrapingError) {
      return `❌ Bank Scraping Error${contextStr}: ${error.message}`;
    }

    if (error instanceof ConfigurationError) {
      return `⚙️  Configuration Error${contextStr}: ${error.message}`;
    }

    // Fallback for unknown errors - try to categorize by message
    return this.categorizeByMessage(error, contextStr);
  }

  private categorizeByMessage(error: Error, contextStr: string): string {
    const message = error.message || 'Unknown error';

    if (message.includes('credentials') || message.includes('login') || message.includes('authentication')) {
      return `🔐 Authentication Error${contextStr}: ${message}. Please verify your credentials.`;
    }

    if (message.includes('network') || message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
      return `🌐 Network Error${contextStr}: Cannot reach the server. Check your internet connection.`;
    }

    if (message.includes('2FA') || message.includes('OTP') || message.includes('verification')) {
      return `📱 2FA Error${contextStr}: ${message}. Check your 2FA device or SMS.`;
    }

    // Default format
    return `❌ Error${contextStr}: ${message}`;
  }
}
