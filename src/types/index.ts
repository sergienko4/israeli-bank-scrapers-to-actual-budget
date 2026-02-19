/**
 * Type definitions for the Israeli Bank Importer
 */

export interface ActualConfig {
  init: {
    dataDir: string;
    serverURL: string;
    password: string;
  };
  budget: {
    syncId: string;
    password: string | null;
  };
}

export interface BankTarget {
  actualAccountId: string;
  reconcile: boolean;
  accounts: string[] | 'all';
}

export interface BankConfig {
  // Common fields
  startDate?: string;   // Fixed date: "2026-02-15"
  daysBack?: number;    // Relative: 14 = last 14 days (overrides startDate)
  targets?: BankTarget[];

  // Bank-specific credentials (different per bank)
  // Discount
  id?: string;
  password?: string;
  num?: string;

  // Hapoalim
  userCode?: string;

  // Leumi, Union, etc
  username?: string;

  // Yahav
  nationalID?: string;

  // Isracard, Amex
  card6Digits?: string;

  // OneZero
  email?: string;
  phoneNumber?: string;
  otpLongTermToken?: string; // Persisted after first OTP login

  // 2FA settings (per bank)
  twoFactorAuth?: boolean;          // Default: false. Set true for banks requiring OTP
  twoFactorTimeout?: number;        // Seconds to wait for OTP reply. Default: 300

  [key: string]: any; // Allow other bank-specific fields
}

export interface BankTransaction {
  identifier?: string | number;
  chargedAmount?: number;
  originalAmount?: number;
  date: Date | string;
  description?: string;
  memo?: string;
}

export type MessageFormat = 'compact' | 'ledger' | 'emoji' | 'summary';
export type ShowTransactions = 'new' | 'all' | 'none';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  messageFormat?: MessageFormat;       // Default: 'summary'
  showTransactions?: ShowTransactions;  // Default: 'new'
  listenForCommands?: boolean;         // Default: false
}

export interface NotificationConfig {
  enabled: boolean;
  telegram?: TelegramConfig;
}

export interface ImporterConfig {
  actual: ActualConfig;
  banks: Record<string, BankConfig>;
  notifications?: NotificationConfig;
  delayBetweenBanks?: number;  // Milliseconds to wait between bank imports (default: 0)
}

export interface ResilienceConfig {
  scrapingTimeoutMs: number;
  maxRetryAttempts: number;
  initialBackoffMs: number;
}

export const DEFAULT_RESILIENCE_CONFIG: ResilienceConfig = {
  scrapingTimeoutMs: 10 * 60 * 1000, // 10 minutes
  maxRetryAttempts: 3,
  initialBackoffMs: 1000 // 1 second
};

export interface TransactionRecord {
  date: string;
  description: string;
  amount: number;
}

/** Matches @actual-app/api's APIAccountEntity shape */
export interface ActualAccount {
  id: string;
  name: string;
  offbudget?: boolean;
  closed?: boolean;
}

export interface TelegramMessageData {
  chat: { id: number };
  text?: string;
  date: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessageData;
}

export interface TelegramApiResponse {
  ok: boolean;
  result?: TelegramUpdate[];
}
