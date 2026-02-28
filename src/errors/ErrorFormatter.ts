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

// Constructor type for instanceof checks — requires function-type for polymorphic dispatch
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type ErrorClass = Function;

const errorFormats: Array<{ type: ErrorClass; entry: ErrorFormatEntry }> = [
  { type: TimeoutError,
    entry: { icon: '⏱️ ', label: 'Timeout Error',
      suffix: ". The bank's website may be slow or unresponsive." } },
  { type: AuthenticationError,
    entry: { icon: '🔐', label: 'Authentication Error',
      suffix: '. Please verify your credentials.' } },
  { type: NetworkError,
    entry: { icon: '🌐', label: 'Network Error',
      suffix: '. Check your internet connection.' } },
  { type: TwoFactorAuthError,
    entry: { icon: '📱', label: '2FA Error', suffix: '. Check your 2FA device or SMS.' } },
  { type: ShutdownError,  entry: { icon: '🛑', label: 'Operation Cancelled' } },
  { type: BankScrapingError, entry: { icon: '❌', label: 'Bank Scraping Error' } },
  { type: ConfigurationError, entry: { icon: '⚙️ ', label: 'Configuration Error' } },
];

// Keyword-based fallback categorization (OCP map)
type MessageCategory = { keywords: string[]; icon: string; label: string; suffix?: string };
const messageCategories: MessageCategory[] = [
  { keywords: ['credentials', 'login', 'authentication'],
    icon: '🔐', label: 'Authentication Error',
    suffix: '. Please verify your credentials.' },
  { keywords: ['network', 'ECONNREFUSED', 'ENOTFOUND'],
    icon: '🌐', label: 'Network Error',
    suffix: '. Cannot reach the server. Check your internet connection.' },
  { keywords: ['2FA', 'OTP', 'verification'],
    icon: '📱', label: '2FA Error', suffix: '. Check your 2FA device or SMS.' },
  { keywords: ['WAF', 'WafBlock', 'cloudflare'],
    icon: '🛡️', label: 'WAF Blocked',
    suffix: '. Bank WAF blocked the request. Wait 1-2 hours and retry.' },
];

export class ErrorFormatter implements IErrorFormatter {
  format(error: Error, context: string = ''): string {
    const ctx = context ? ` (${context})` : '';
    if (error.name === 'WafBlockError') {
      return `🛡️ WAF Blocked${ctx}: ${error.message}. Wait 1-2 hours and retry.`;
    }
    const match = errorFormats.find(f => error instanceof f.type);
    if (match) {
      const suffix = match.entry.suffix || '';
      return `${match.entry.icon} ${match.entry.label}${ctx}: ${error.message}${suffix}`;
    }
    return this.categorizeByMessage(error, ctx);
  }

  private categorizeByMessage(error: Error, ctx: string): string {
    const message = error.message || 'Unknown error';
    const match = messageCategories.find(c => c.keywords.some(k => message.includes(k)));
    if (match) {
      const detail = match.suffix ? match.suffix.slice(2) : message;
      return `${match.icon} ${match.label}${ctx}: ${detail}`;
    }
    return `❌ Error${ctx}: ${message}`;
  }
}
