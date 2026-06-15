/**
 * Notification channel configuration (Telegram, webhook) and spending-watch rules.
 */

export type MessageFormat = 'compact' | 'ledger' | 'emoji' | 'summary';
export type ShowTransactions = 'new' | 'all' | 'none';

export interface ITelegramConfig {
  botToken: string;
  chatId: string;
  messageFormat?: MessageFormat;       // Default: 'summary'
  showTransactions?: ShowTransactions;  // Default: 'new'
  listenForCommands?: boolean;         // Default: false
  enableReceiptImport?: boolean;       // Default: false
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

/** Rule that triggers a Telegram alert when spending exceeds a threshold. */
export interface ISpendingWatchRule {
  alertFromAmount: number;     // Trigger if total spending > this (currency units)
  numOfDayToCount: number;     // Time window in days (1 = today only)
  watchPayees?: string[];      // Filter payees (substring match). Missing = all payees
}
