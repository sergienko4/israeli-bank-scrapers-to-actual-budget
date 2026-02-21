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

export interface SpendingWatchRule {
  alertFromAmount: number;     // Trigger if total spending > this (currency units)
  numOfDayToCount: number;     // Time window in days (1 = today only)
  watchPayees?: string[];      // Filter payees (substring match). Missing = all payees
}

export interface ImporterConfig {
  actual: ActualConfig;
  banks: Record<string, BankConfig>;
  notifications?: NotificationConfig;
  logConfig?: LogConfig;
  categorization?: CategorizationConfig;
  spendingWatch?: SpendingWatchRule[];  // Spending watch rules (empty/missing = disabled)
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
