/**
 * Type definitions for the Israeli Bank Importer
 */

// Result Pattern
import type { Procedure as ProcedureType } from './Procedure.js';
export type { IProcedureFailure, IProcedureSuccess, Procedure } from './Procedure.js';
export { fail, fromPromise, isFail,isSuccess, succeed } from './ProcedureHelpers.js';


/** Connection and budget settings for the Actual Budget server. */
export interface IActualConfig {
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

export interface IBankTransaction {
  identifier?: string | number;
  chargedAmount?: number;
  originalAmount?: number;
  date: Date | string;
  description?: string;
  memo?: string;
}

export type MessageFormat = 'compact' | 'ledger' | 'emoji' | 'summary';
export type ShowTransactions = 'new' | 'all' | 'none';

export interface ITelegramConfig {
  botToken: string;
  chatId: string;
  messageFormat?: MessageFormat;       // Default: 'summary'
  showTransactions?: ShowTransactions;  // Default: 'new'
  listenForCommands?: boolean;         // Default: false
}

export type WebhookFormat = 'slack' | 'discord' | 'plain';

export interface IWebhookConfig {
  url: string;
  format?: WebhookFormat;  // Default: 'plain'
}

export interface INotificationConfig {
  enabled: boolean;
  maxTransactions?: number;  // Default: 5. Max transactions per account in notifications (1-25)
  telegram?: ITelegramConfig;
  webhook?: IWebhookConfig;
}

export type LogFormat = 'words' | 'json' | 'table' | 'phone';

export interface ILogConfig {
  format?: LogFormat;          // Default: 'words'
  maxBufferSize?: number;      // Deprecated: kept for backward compat, no longer functional
  logDir?: string;             // Log file directory. Default: './logs'
}

export type CategorizationMode = 'history' | 'translate' | 'none';

export interface ITranslationRule {
  fromPayee: string;   // Hebrew text to find in bank payee name
  toPayee: string;     // English name to use in Actual Budget
}

export interface ICategorizationConfig {
  mode?: CategorizationMode;        // Default: 'none'
  translations?: ITranslationRule[]; // Only used when mode='translate'
}

/** Result of category resolution — either a category ID or a payee translation */
export interface IResolvedCategory {
  categoryId?: string;     // For history mode
  payeeName?: string;      // For translate mode (translated name)
  importedPayee?: string;  // Original name (preserved for reference)
}

/** Rule that triggers a Telegram alert when spending exceeds a threshold. */
export interface ISpendingWatchRule {
  alertFromAmount: number;     // Trigger if total spending > this (currency units)
  numOfDayToCount: number;     // Time window in days (1 = today only)
  watchPayees?: string[];      // Filter payees (substring match). Missing = all payees
}

/** Optional SOCKS5/HTTP proxy for Chromium scraping (useful in restricted networks). */
export interface IProxyConfig {
  server: string;  // socks5://host:port or http://host:port
}

/** Root configuration object — represents the full contents of `config.json`. */
export interface IImporterConfig {
  actual: IActualConfig;
  banks: Record<string, IBankConfig>;
  notifications?: INotificationConfig;
  logConfig?: ILogConfig;
  categorization?: ICategorizationConfig;
  spendingWatch?: ISpendingWatchRule[];  // Spending watch rules (empty/missing = disabled)
  delayBetweenBanks?: number;  // Milliseconds to wait between bank imports (default: 0)
  proxy?: IProxyConfig;   // Optional proxy for Chromium (socks5/http)
}

export interface IResilienceConfig {
  scrapingTimeoutMs: number;
  maxRetryAttempts: number;
  initialBackoffMs: number;
}

export const DEFAULT_RESILIENCE_CONFIG: IResilienceConfig = {
  scrapingTimeoutMs: 10 * 60 * 1000, // 10 minutes
  maxRetryAttempts: 3,
  initialBackoffMs: 1000 // 1 second
};

export interface ITransactionRecord {
  date: string;
  description: string;
  amount: number;
}

/** Matches @actual-app/api's APIAccountEntity shape */
export interface IActualAccount {
  id: string;
  name: string;
  offbudget?: boolean;
  closed?: boolean;
}

export interface ITelegramMessageData {
  chat: { id: number };
  text?: string;
  date: number;
}

export interface ITelegramCallbackQuery {
  id: string;
  data?: string;
  message?: { chat: { id: number }; date: number };
}

export interface ITelegramUpdate {
  update_id: number;
  message?: ITelegramMessageData;
  callback_query?: ITelegramCallbackQuery;
}

export interface ITelegramApiResponse {
  ok: boolean;
  result?: ITelegramUpdate[];
}

// ─── Import queue / mediator types ───

/** Source that triggered an import request. */
export type ImportSource = 'cron' | 'telegram' | 'api';

/** Options passed to ImportMediator.requestImport(). */
export interface IImportRequestOptions {
  /** Who triggered this import. */
  readonly source: ImportSource;
  /** Optional list of bank names; undefined = all banks. */
  readonly banks?: string[];
  /** Extra environment variables for the child process. */
  readonly extraEnv?: Record<string, string>;
}

/** A single queued import job. */
export interface IImportJob {
  /** Unique job identifier. */
  readonly id: string;
  /** Bank name (or comma-separated list / "all"). */
  readonly bankName: string;
  /** Batch this job belongs to. */
  readonly batchId: string;
  /** Source that triggered this import. */
  readonly source: ImportSource;
}

/** Result of a single import job. */
export interface IImportJobResult {
  /** The completed job. */
  readonly job: IImportJob;
  /** Child process exit code (0 = success). */
  readonly exitCode: number;
  /** Duration in milliseconds. */
  readonly durationMs: number;
}

/** Aggregate result of a batch of import jobs. */
export interface IBatchResult {
  /** Unique batch identifier. */
  readonly batchId: string;
  /** Source that triggered this batch. */
  readonly source: ImportSource;
  /** Individual job results. */
  readonly jobs: IImportJobResult[];
  /** Total duration in milliseconds. */
  readonly totalDurationMs: number;
  /** Number of successful jobs. */
  readonly successCount: number;
  /** Number of failed jobs. */
  readonly failureCount: number;
}

/** Callbacks for ImportQueue lifecycle events. */
export interface IQueueCallbacks<T, TResult = IImportJobResult> {
  /** Processes a single queued item. Returns the result. */
  readonly process: (item: T) => Promise<TResult>;
  /** Called after each item completes (success or failure). */
  readonly onJobComplete: (item: T, result: TResult | Error) => ProcedureType<{ status: string }>;
  /** Called when the queue drains completely. */
  readonly onQueueEmpty: () => ProcedureType<{ status: string }>;
}
