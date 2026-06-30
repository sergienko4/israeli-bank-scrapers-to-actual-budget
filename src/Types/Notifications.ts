/**
 * Notification channel configuration (Telegram, webhook) and spending-watch rules.
 */

/** Telegram message-format options (single source for type + UI). */
export const MESSAGE_FORMATS = ['summary', 'compact', 'ledger', 'emoji'] as const;

/** Telegram message format. Default: 'summary'. */
export type MessageFormat = typeof MESSAGE_FORMATS[number];

/** Which transactions to list in notifications (single source for type + UI). */
export const SHOW_TRANSACTIONS_OPTIONS = ['new', 'all', 'none'] as const;

/** Which transactions to show. Default: 'new'. */
export type ShowTransactions = typeof SHOW_TRANSACTIONS_OPTIONS[number];

export interface ITelegramConfig {
  botToken: string;
  chatId: string;
  messageFormat?: MessageFormat;       // Default: 'summary'
  showTransactions?: ShowTransactions;  // Default: 'new'
  listenForCommands?: boolean;         // Default: false
  enableReceiptImport?: boolean;       // Default: false
}

/** Webhook payload format options (single source for type + UI). */
export const WEBHOOK_FORMATS = ['plain', 'slack', 'discord'] as const;

/** Webhook payload format. Default: 'plain'. */
export type WebhookFormat = typeof WEBHOOK_FORMATS[number];

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
