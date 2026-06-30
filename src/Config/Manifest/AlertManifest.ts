/**
 * Manifest entries for alerting sections: notifications (Telegram + webhook),
 * spending-watch rules, and transaction categorization.
 */

import {
  CATEGORIZATION_MODES, MESSAGE_FORMATS, SHOW_TRANSACTIONS_OPTIONS, WEBHOOK_FORMATS,
} from '../../Types/Index.js';
import type { IManifestSection } from './ManifestTypes.js';

/** Notifications (Telegram + webhook) section. */
export const NOTIFICATIONS_SECTION: IManifestSection = {
  key: 'notifications', label: 'Alerts', icon: '🔔', kind: 'object',
  doc: 'notifications/telegram.md',
  fields: [
    {
      key: 'enabled', label: 'Enabled', kind: 'boolean',
      help: 'Master switch for notifications.',
    },
    {
      key: 'maxTransactions', label: 'Max transactions', kind: 'number', min: 1, max: 25,
      help: 'Max transactions per account in notifications (1-25). Default 5.',
    },
    {
      key: 'telegram', label: 'Telegram', kind: 'group', fields: [
        { key: 'botToken', label: 'Bot token', kind: 'secret', help: 'Telegram bot token.' },
        { key: 'chatId', label: 'Chat id', kind: 'string', help: 'Target chat id.' },
        {
          key: 'messageFormat', label: 'Message format', kind: 'select', options: MESSAGE_FORMATS,
          help: 'summary | compact | ledger | emoji.',
        },
        {
          key: 'showTransactions', label: 'Show transactions', kind: 'select',
          options: SHOW_TRANSACTIONS_OPTIONS, help: 'new | all | none.',
        },
        {
          key: 'listenForCommands', label: 'Listen for commands', kind: 'boolean',
          help: 'Bot listens for /scan, /status, /logs, /help.',
        },
        {
          key: 'enableReceiptImport', label: 'Receipt import', kind: 'boolean',
          help: 'Enable /import_receipt OCR. Requires listenForCommands.',
        },
      ],
    },
    {
      key: 'webhook', label: 'Webhook', kind: 'group', fields: [
        { key: 'url', label: 'Webhook URL', kind: 'secret', help: 'Slack/Discord/custom URL.' },
        {
          key: 'format', label: 'Format', kind: 'select', options: WEBHOOK_FORMATS,
          help: 'slack | discord | plain.',
        },
      ],
    },
  ],
};

/** Spending-watch rules (list) section. */
export const SPENDING_WATCH_SECTION: IManifestSection = {
  key: 'spendingWatch', label: 'Watch', icon: '👀', kind: 'list',
  doc: 'configuration/spending-watch.md',
  itemFields: [
    {
      key: 'alertFromAmount', label: 'Alert from amount', kind: 'number', min: 1, required: true,
      help: 'Trigger if total spending exceeds this amount.',
    },
    {
      key: 'numOfDayToCount', label: 'Days to count', kind: 'number', min: 1, max: 365,
      required: true, help: 'Time window in days (1 = today only).',
    },
    {
      key: 'watchPayees', label: 'Watch payees', kind: 'list',
      help: 'Optional payee substrings to match. Empty = all payees.',
    },
  ],
};

/** Transaction categorization section. */
export const CATEGORIZATION_SECTION: IManifestSection = {
  key: 'categorization', label: 'Categories', icon: '🏷️', kind: 'object',
  doc: 'configuration/categorization.md',
  fields: [
    {
      key: 'mode', label: 'Mode', kind: 'select', options: CATEGORIZATION_MODES,
      help: 'none | history | translate.',
    },
    {
      key: 'translations', label: 'Translations', kind: 'list',
      help: 'Payee translation rules (used when mode = translate).',
      fields: [
        { key: 'fromPayee', label: 'From (Hebrew)', kind: 'string' },
        { key: 'toPayee', label: 'To (English)', kind: 'string' },
      ],
    },
  ],
};
