/**
 * Bank import target, per-bank credentials/config, and transaction shapes.
 */

/** Maps a scraped bank account to an Actual Budget account. */
export interface IBankTarget {
  actualAccountId: string;
  accountName?: string;      // optional friendly label shown in logs and notifications
  reconcile: boolean;
  accounts: string[] | 'all';
}

export interface IBankConfig {
  // Common fields
  startDate?: string;   // Fixed date: "2026-02-15"
  daysBack?: number;    // Relative: 14 = last 14 days (overrides startDate)
  targets?: IBankTarget[];

  // Bank-specific credentials (different per bank)
  // Discount
  id?: string;
  password?: string;
  num?: string;

  // Hapoalim
  userCode?: string;

  // Leumi, Mizrahi, etc
  username?: string;

  // Yahav
  nationalID?: string;

  // Isracard, Amex
  card6Digits?: string;

  // OneZero, PayBox, Pepper
  email?: string;
  phoneNumber?: string;
  otpLongTermToken?: string; // Persisted after first OTP login

  // 2FA settings (per bank)
  twoFactorAuth?: boolean;          // Default: false. Set true for banks requiring OTP
  twoFactorTimeout?: number;        // Seconds to wait for OTP reply. Default: 300

  // Session management
  clearSession?: boolean;  // Default: false. Set true to clear chrome-data before scraping

  // Scraper tuning (per bank)
  timeout?: number;                  // Navigation timeout in ms. Default: 30000
  navigationRetryCount?: number;     // Retries on page.goto failure. Default: 0

  [key: string]: unknown; // Allow other bank-specific fields
}

export interface IBankTransaction {
  identifier?: string | number;
  chargedAmount?: number;
  originalAmount?: number;
  date: Date | string;
  description?: string;
  memo?: string;
}

export interface ITransactionRecord {
  date: string;
  description: string;
  amount: number;
}
