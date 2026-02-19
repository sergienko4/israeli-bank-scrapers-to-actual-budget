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
  startDate?: string;
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

  [key: string]: any; // Allow other bank-specific fields
}

export type MessageFormat = 'compact' | 'ledger' | 'emoji' | 'summary';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  messageFormat?: MessageFormat; // Default: 'summary'
}

export interface NotificationConfig {
  enabled: boolean;
  telegram?: TelegramConfig;
}

export interface ImporterConfig {
  actual: ActualConfig;
  banks: Record<string, BankConfig>;
  notifications?: NotificationConfig;
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

export interface ReconciliationResult {
  status: 'created' | 'skipped' | 'already-reconciled';
  diff: number;  // Amount in cents
}
