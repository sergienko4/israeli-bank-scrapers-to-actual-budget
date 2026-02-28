/**
 * Type definitions for the Israeli Bank Importer
 */

/** Connection and budget settings for the Actual Budget server. */
export interface ActualConfig {
  init: {
    /** Local directory for cached budget data. */
    dataDir: string;
    /** URL of the Actual Budget server (e.g. `http://actual_server:5006`). */
    serverURL: string;
    /** Actual Budget server password. */
    password: string;
  };
  budget: {
    /** UUID of the budget to sync (found in Actual Budget → Settings). */
    syncId: string;
    /** Optional password for an encrypted budget. */
    password: string | null;
  };
}

/** Maps a scraped bank account to an Actual Budget account. */
export interface BankTarget {
  actualAccountId: string;
  accountName?: string;      // optional friendly label shown in logs and notifications
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

  // Session management
  clearSession?: boolean;  // Default: false. Set true to clear chrome-data before scraping

  // Scraper tuning (per bank)
  timeout?: number;                  // Navigation timeout in ms. Default: 30000
  navigationRetryCount?: number;     // Retries on page.goto failure. Default: 0

  [key: string]: unknown; // Allow other bank-specific fields
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

export type WebhookFormat = 'slack' | 'discord' | 'plain';

export interface WebhookConfig {
  url: string;
  format?: WebhookFormat;  // Default: 'plain'
}

export interface NotificationConfig {
  enabled: boolean;
  maxTransactions?: number;  // Default: 5. Max transactions per account in notifications (1-25)
  telegram?: TelegramConfig;
  webhook?: WebhookConfig;
}

export type LogFormat = 'words' | 'json' | 'table' | 'phone';

export interface LogConfig {
  format?: LogFormat;          // Default: 'words'
  maxBufferSize?: number;      // Ring buffer max entries for /logs command. Default: 150
}

export type CategorizationMode = 'history' | 'translate' | 'none';

export interface TranslationRule {
  fromPayee: string;   // Hebrew text to find in bank payee name
  toPayee: string;     // English name to use in Actual Budget
}

export interface CategorizationConfig {
  mode?: CategorizationMode;        // Default: 'none'
  translations?: TranslationRule[]; // Only used when mode='translate'
}

/** Result of category resolution — either a category ID or a payee translation */
export interface ResolvedCategory {
  categoryId?: string;     // For history mode
  payeeName?: string;      // For translate mode (translated name)
  importedPayee?: string;  // Original name (preserved for reference)
}

/** Rule that triggers a Telegram alert when spending exceeds a threshold. */
export interface SpendingWatchRule {
  alertFromAmount: number;     // Trigger if total spending > this (currency units)
  numOfDayToCount: number;     // Time window in days (1 = today only)
  watchPayees?: string[];      // Filter payees (substring match). Missing = all payees
}

/** Optional SOCKS5/HTTP proxy for Chromium scraping (useful in restricted networks). */
export interface ProxyConfig {
  server: string;  // socks5://host:port or http://host:port
}

/** Root configuration object — represents the full contents of `config.json`. */
export interface ImporterConfig {
  actual: ActualConfig;
  banks: Record<string, BankConfig>;
  notifications?: NotificationConfig;
  logConfig?: LogConfig;
  categorization?: CategorizationConfig;
  spendingWatch?: SpendingWatchRule[];  // Spending watch rules (empty/missing = disabled)
  delayBetweenBanks?: number;  // Milliseconds to wait between bank imports (default: 0)
  proxy?: ProxyConfig;   // Optional proxy for Chromium (socks5/http)
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
