/**
 * Error formatter for user-friendly error messages
 * Follows Open/Closed Principle: Add new error types to the map without modifying format()
 */

export interface IErrorFormatter {
  format(error: Error, context?: string): string;
}

// OCP: add new error types by adding entries — no changes to format()
interface IErrorFormatEntry { icon: string; label: string; suffix?: string }

// Uses error.name instead of instanceof to avoid the Function type entirely.
// All project error classes set this.name in their constructor.
const ERROR_FORMATS: { name: string; entry: IErrorFormatEntry }[] = [
  { name: 'TimeoutError',
    entry: { icon: '⏱️ ', label: 'Timeout Error',
      suffix: ". The bank's website may be slow or unresponsive." } },
  { name: 'AuthenticationError',
    entry: { icon: '🔐', label: 'Authentication Error',
      suffix: '. Please verify your credentials.' } },
  { name: 'NetworkError',
    entry: { icon: '🌐', label: 'Network Error',
      suffix: '. Check your internet connection.' } },
  { name: 'TwoFactorAuthError',
    entry: { icon: '📱', label: '2FA Error', suffix: '. Check your 2FA device or SMS.' } },
  { name: 'ShutdownError',  entry: { icon: '🛑', label: 'Operation Cancelled' } },
  { name: 'BankScrapingError', entry: { icon: '❌', label: 'Bank Scraping Error' } },
  { name: 'ConfigurationError', entry: { icon: '⚙️ ', label: 'Configuration Error' } },
];

// Keyword-based fallback categorization (OCP map)
interface IMessageCategory { keywords: string[]; icon: string; label: string; suffix?: string }
const MESSAGE_CATEGORIES: IMessageCategory[] = [
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

/** Formats Error objects into human-readable notification strings. */
export class ErrorFormatter implements IErrorFormatter {
  /** Error format registry used by this formatter instance. */
  private readonly _formats = ERROR_FORMATS;

  /**
   * Format an error into a user-friendly message string.
   * @param error - The error to format.
   * @param context - Optional context label appended in parentheses.
   * @returns A formatted string with icon, label, and error detail.
   */
  public format(error: Error, context = ''): string {
    const ctx = context ? ` (${context})` : '';
    if (error.name === 'WafBlockError') {
      return `🛡️ WAF Blocked${ctx}: ${error.message}. Wait 1-2 hours and retry.`;
    }
    const match = this._formats.find(f => error.name === f.name);
    if (match) {
      const suffix = match.entry.suffix || '';
      return `${match.entry.icon} ${match.entry.label}${ctx}: ${error.message}${suffix}`;
    }
    return ErrorFormatter.categorizeByMessage(error, ctx);
  }

  /**
   * Classify an unknown error by keywords in its message.
   * @param error - The error whose message will be inspected.
   * @param ctx - Formatted context string to include in the output.
   * @returns A categorized or generic error string.
   */
  private static categorizeByMessage(error: Error, ctx: string): string {
    const message = error.message || 'Unknown error';
    const match = MESSAGE_CATEGORIES.find(c => c.keywords.some(k => message.includes(k)));
    if (match) {
      const detail = match.suffix ? match.suffix.slice(2) : message;
      return `${match.icon} ${match.label}${ctx}: ${detail}`;
    }
    return `❌ Error${ctx}: ${message}`;
  }
}
