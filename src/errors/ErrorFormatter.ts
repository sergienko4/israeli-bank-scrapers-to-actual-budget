/**
 * Error formatter for user-friendly error messages
 * Follows Open/Closed Principle: Add new error types to the map without modifying format()
 */

import {
  TimeoutError, AuthenticationError, NetworkError,
  TwoFactorAuthError, ShutdownError, BankScrapingError, ConfigurationError
} from './ErrorTypes.js';

export interface IErrorFormatter {
  format(error: Error, context?: string): string;
}

// OCP: add new error types by adding entries — no changes to format()
type ErrorFormatEntry = { icon: string; label: string; suffix?: string };

const errorFormats: Array<{ type: Function; entry: ErrorFormatEntry }> = [
  { type: TimeoutError,         entry: { icon: '⏱️ ', label: 'Timeout Error', suffix: ". The bank's website may be slow or unresponsive." } },
  { type: AuthenticationError,  entry: { icon: '🔐', label: 'Authentication Error', suffix: '. Please verify your credentials.' } },
  { type: NetworkError,         entry: { icon: '🌐', label: 'Network Error', suffix: '. Check your internet connection.' } },
  { type: TwoFactorAuthError,   entry: { icon: '📱', label: '2FA Error', suffix: '. Check your 2FA device or SMS.' } },
  { type: ShutdownError,        entry: { icon: '🛑', label: 'Operation Cancelled' } },
  { type: BankScrapingError,    entry: { icon: '❌', label: 'Bank Scraping Error' } },
  { type: ConfigurationError,   entry: { icon: '⚙️ ', label: 'Configuration Error' } },
];

// Keyword-based fallback categorization (OCP map)
const messageCategories: Array<{ keywords: string[]; icon: string; label: string; suffix?: string }> = [
  { keywords: ['credentials', 'login', 'authentication'], icon: '🔐', label: 'Authentication Error', suffix: '. Please verify your credentials.' },
  { keywords: ['network', 'ECONNREFUSED', 'ENOTFOUND'],   icon: '🌐', label: 'Network Error', suffix: '. Cannot reach the server. Check your internet connection.' },
  { keywords: ['2FA', 'OTP', 'verification'],              icon: '📱', label: '2FA Error', suffix: '. Check your 2FA device or SMS.' },
];

export class ErrorFormatter implements IErrorFormatter {
  format(error: Error, context: string = ''): string {
    const ctx = context ? ` (${context})` : '';
    const match = errorFormats.find(f => error instanceof f.type);
    if (match) return `${match.entry.icon} ${match.entry.label}${ctx}: ${error.message}${match.entry.suffix || ''}`;
    return this.categorizeByMessage(error, ctx);
  }

  private categorizeByMessage(error: Error, ctx: string): string {
    const message = error.message || 'Unknown error';
    const match = messageCategories.find(c => c.keywords.some(k => message.includes(k)));
    if (match) return `${match.icon} ${match.label}${ctx}: ${match.suffix ? match.suffix.slice(2) : message}`;
    return `❌ Error${ctx}: ${message}`;
  }
}
