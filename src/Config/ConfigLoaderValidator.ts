/**
 * Validation helpers extracted from ConfigLoader to keep it within the 300-line limit.
 * All functions throw ConfigurationError on the first rule violation they find.
 */
import type {
  ImporterConfig, BankConfig, NotificationConfig, SpendingWatchRule, ProxyConfig
} from '../Types/Index.js';
import { ConfigurationError } from '../Errors/ErrorTypes.js';

// OCP: add new banks by adding entries — no if/else changes needed
type CredentialSpec = { displayName: string; required: (keyof BankConfig)[]; label: string };
const credentialSpecs: Record<string, CredentialSpec> = {
  discount:  { displayName: 'Discount bank', required: ['id', 'password', 'num'],
    label: 'id, password, num' },
  leumi:     { displayName: 'leumi',         required: ['username', 'password'],
    label: 'username, password' },
  hapoalim:  { displayName: 'Hapoalim',      required: ['userCode', 'password'],
    label: 'userCode, password' },
  yahav:     { displayName: 'Yahav',         required: ['nationalID', 'password'],
    label: 'nationalID, password' },
  onezero:   { displayName: 'OneZero',       required: ['email', 'password', 'phoneNumber'],
    label: 'email, password, phoneNumber' },
  max:       { displayName: 'Max',           required: ['username', 'password', 'id'],
    label: 'username, password, id' },
};

/**
 * Validates the Actual Budget section of the config (password, syncId, server URL).
 * @param config - The config whose actual block is validated.
 */
export function validateActualConfig(config: ImporterConfig): void {
  if (!config.actual.init.password) {
    throw new ConfigurationError(
      'ACTUAL_PASSWORD is required (set via environment variable or config.json)'
    );
  }
  if (!config.actual.budget.syncId) {
    throw new ConfigurationError(
      'ACTUAL_BUDGET_SYNC_ID is required (set via environment variable or config.json)'
    );
  }
  if (!isValidUUID(config.actual.budget.syncId)) {
    throw new ConfigurationError(
      `Invalid ACTUAL_BUDGET_SYNC_ID format. Expected UUID, got: ${config.actual.budget.syncId}`
    );
  }
}

/**
 * Validates that the Actual server URL starts with http:// or https://.
 * @param url - The server URL string to check.
 */
export function validateServerUrl(url: string): void {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new ConfigurationError(
      `Invalid serverURL format. Must start with http:// or https://, got: ${url}`
    );
  }
}

/**
 * Validates notification settings (Telegram and webhook) when notifications are enabled.
 * @param config - The NotificationConfig block to validate.
 */
export function validateNotifications(config: NotificationConfig): void {
  if (config.telegram) validateTelegramConfig(config.telegram);
  if (config.webhook) validateWebhookConfig(config.webhook);
}

/**
 * Validates Telegram bot token, chat ID, and enum fields.
 * @param telegram - The Telegram notification config to validate.
 */
function validateTelegramConfig(telegram: NonNullable<NotificationConfig['telegram']>): void {
  if (!telegram.botToken) {
    throw new ConfigurationError(
      'Telegram botToken is required when telegram notifications are configured'
    );
  }
  if (!/^\d+:.+$/.test(telegram.botToken)) {
    throw new ConfigurationError(
      'Invalid Telegram botToken format. Expected format: "123456789:ABCdef..."'
    );
  }
  if (!telegram.chatId) {
    throw new ConfigurationError(
      'Telegram chatId is required when telegram notifications are configured'
    );
  }
  validateEnumField(telegram.messageFormat, ['summary', 'compact', 'ledger', 'emoji'],
    'messageFormat');
  validateEnumField(telegram.showTransactions, ['new', 'all', 'none'], 'showTransactions');
}

/**
 * Validates the spending watch rules array.
 * @param rules - Array of SpendingWatchRule objects to validate.
 */
export function validateSpendingWatch(rules: SpendingWatchRule[]): void {
  if (!Array.isArray(rules)) {
    throw new ConfigurationError('spendingWatch must be an array of rules');
  }
  rules.forEach((rule, idx) => validateWatchRule(rule, idx));
}

/**
 * Validates a single spending watch rule entry.
 * @param rule - The SpendingWatchRule to check.
 * @param idx - Zero-based index of the rule, used in error messages.
 */
function validateWatchRule(rule: SpendingWatchRule, idx: number): void {
  if (!rule.alertFromAmount || rule.alertFromAmount <= 0) {
    throw new ConfigurationError(
      `spendingWatch[${idx}]: alertFromAmount is required and must be positive`
    );
  }
  const { numOfDayToCount } = rule;
  if (!numOfDayToCount || !Number.isInteger(numOfDayToCount)
    || numOfDayToCount < 1 || numOfDayToCount > 365) {
    throw new ConfigurationError(
      `spendingWatch[${idx}]: numOfDayToCount must be an integer between 1 and 365`
    );
  }
  if (rule.watchPayees !== undefined && !Array.isArray(rule.watchPayees)) {
    throw new ConfigurationError(
      `spendingWatch[${idx}]: watchPayees must be an array of strings`
    );
  }
}

/**
 * Validates the webhook URL and format enum.
 * @param webhook - The webhook notification config to validate.
 */
function validateWebhookConfig(webhook: NonNullable<NotificationConfig['webhook']>): void {
  if (!webhook.url) {
    throw new ConfigurationError(
      'Webhook url is required when webhook notifications are configured'
    );
  }
  if (!webhook.url.startsWith('http://') && !webhook.url.startsWith('https://')) {
    throw new ConfigurationError(
      `Invalid webhook url format. Must start with http:// or https://, got: ${webhook.url}`
    );
  }
  validateEnumField(webhook.format, ['slack', 'discord', 'plain'], 'webhook format');
}

/**
 * Validates the proxy configuration server URL format.
 * @param proxy - The ProxyConfig to validate.
 */
export function validateProxy(proxy: ProxyConfig): void {
  if (!proxy.server) {
    throw new ConfigurationError('proxy.server is required when proxy is configured');
  }
  const validPrefixes = ['socks5://', 'socks4://', 'http://', 'https://'];
  if (!validPrefixes.some(p => proxy.server.startsWith(p))) {
    throw new ConfigurationError(
      `Invalid proxy.server format "${proxy.server}". ` +
      `Must start with socks5://, socks4://, http://, or https://`
    );
  }
}

/**
 * Validates that a field value is one of the allowed enum strings.
 * @param value - The field value to check (may be undefined).
 * @param allowed - Array of permitted string values.
 * @param fieldName - Display name of the field used in error messages.
 */
function validateEnumField(value: string | undefined, allowed: string[], fieldName: string): void {
  if (value && !allowed.includes(value)) {
    throw new ConfigurationError(
      `Invalid ${fieldName} "${value}". Must be one of: ${allowed.join(', ')}`
    );
  }
}

/**
 * Checks whether a string matches the standard UUID v4 format.
 * @param uuid - The string to test.
 * @returns True if the string is a valid UUID.
 */
export function isValidUUID(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
}

/**
 * Validates all settings for a single bank entry.
 * @param bankName - The key used for this bank in the banks map.
 * @param config - The BankConfig object to validate.
 */
export function validateBank(bankName: string, config: BankConfig): void {
  validateDateConfig(bankName, config);
  validateTargets(bankName, config.targets);
  validateBankCredentials(bankName, config);
}

/**
 * Validates that only one of startDate or daysBack is set, and their values are in range.
 * @param bankName - Bank name used in error messages.
 * @param config - The bank config containing the date settings.
 */
function validateDateConfig(bankName: string, config: BankConfig): void {
  if (config.startDate && config.daysBack) {
    throw new ConfigurationError(
      `${bankName}: cannot use both "startDate" and "daysBack". Choose one.`
    );
  }
  if (config.daysBack !== undefined) validateDaysBack(bankName, config.daysBack);
  if (config.startDate) validateStartDate(bankName, config.startDate);
}

/**
 * Validates that daysBack is an integer between 1 and 30.
 * @param bankName - Bank name used in error messages.
 * @param daysBack - The daysBack value to validate.
 */
function validateDaysBack(bankName: string, daysBack: number): void {
  if (!Number.isInteger(daysBack) || daysBack < 1 || daysBack > 30) {
    throw new ConfigurationError(
      `${bankName}: "daysBack" must be an integer between 1 and 30. Got: ${daysBack}`
    );
  }
}

/**
 * Returns a Date representing exactly one year before today.
 * @returns Date object set to one year ago.
 */
function getOneYearAgo(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d;
}

/**
 * Validates startDate format, ensures it is not in the future, and not older than one year.
 * @param bankName - Bank name used in error messages.
 * @param startDate - The startDate string (YYYY-MM-DD) to validate.
 */
function validateStartDate(bankName: string, startDate: string): void {
  const date = new Date(startDate);
  if (isNaN(date.getTime())) {
    throw new ConfigurationError(
      `Invalid startDate format for ${bankName}: "${startDate}". ` +
      `Expected YYYY-MM-DD format (e.g., "2026-02-15")`
    );
  }
  if (date > new Date()) {
    throw new ConfigurationError(
      `startDate cannot be in the future for ${bankName}. Got: ${startDate}`
    );
  }
  if (date < getOneYearAgo()) {
    throw new ConfigurationError(
      `${bankName}: startDate cannot be more than 1 year ago. Got: ${startDate}`
    );
  }
}

/**
 * Validates that at least one target is configured and each target is valid.
 * @param bankName - Bank name used in error messages.
 * @param targets - The array of BankTarget objects to validate.
 */
function validateTargets(bankName: string, targets: BankConfig['targets']): void {
  if (!targets || targets.length === 0) {
    throw new ConfigurationError(
      `No targets configured for ${bankName}. At least one target is required.`
    );
  }
  targets.forEach((target, idx) => validateTarget(bankName, target, idx));
}

/**
 * Validates that a target's actualAccountId is present and is a valid UUID.
 * @param bankName - Bank name used in error messages.
 * @param accountId - The actualAccountId string to validate.
 * @param idx - Zero-based target index used in error messages.
 */
function validateTargetId(bankName: string, accountId: string, idx: number): void {
  if (!accountId) {
    throw new ConfigurationError(`Missing actualAccountId for ${bankName} target ${idx}`);
  }
  if (!isValidUUID(accountId)) {
    throw new ConfigurationError(
      `Invalid actualAccountId format for ${bankName} target ${idx}.\n` +
      `  Expected: UUID format (e.g., "12345678-1234-1234-1234-123456789abc")\n` +
      `  Got: "${accountId}"`
    );
  }
}

/**
 * Validates that the accounts field is either "all" or a non-empty string array.
 * @param bankName - Bank name used in error messages.
 * @param accounts - The accounts value from the BankTarget.
 * @param idx - Zero-based target index used in error messages.
 */
function validateTargetAccounts(
  bankName: string, accounts: string[] | 'all', idx: number
): void {
  if (!accounts) {
    throw new ConfigurationError(
      `Missing accounts field for ${bankName} target ${idx}. ` +
      `Use "all" or an array of account numbers.`
    );
  }
  if (accounts !== 'all' && (!Array.isArray(accounts) || accounts.length === 0)) {
    throw new ConfigurationError(
      `Invalid accounts field for ${bankName} target ${idx}. ` +
      `Must be "all" or a non-empty array.`
    );
  }
}

/**
 * Validates a single BankTarget: ID, accounts field, and reconcile type.
 * @param bankName - Bank name used in error messages.
 * @param target - The target object to validate.
 * @param target.actualAccountId - UUID of the Actual account.
 * @param target.accounts - Account filter: 'all' or array of account numbers.
 * @param target.reconcile - Whether reconciliation is enabled for this target.
 * @param idx - Zero-based target index used in error messages.
 */
function validateTarget(
  bankName: string,
  target: { actualAccountId: string; accounts: string[] | 'all'; reconcile: boolean },
  idx: number
): void {
  validateTargetId(bankName, target.actualAccountId, idx);
  validateTargetAccounts(bankName, target.accounts, idx);
  if (typeof target.reconcile !== 'boolean') {
    throw new ConfigurationError(
      `Invalid reconcile field for ${bankName} target ${idx}. Must be true or false.`
    );
  }
}

/**
 * Validates credential field formats and required credential presence for a bank.
 * @param bankName - The bank key used to look up the credential spec.
 * @param config - The BankConfig whose credentials to validate.
 */
function validateBankCredentials(bankName: string, config: BankConfig): void {
  validateFieldFormats(bankName, config);
  validateRequiredCredentials(bankName, config);
}

/**
 * Validates email, phone number, and card6Digits format for a bank config.
 * @param bankName - Bank name used in error messages.
 * @param config - The BankConfig whose field formats to validate.
 */
function validateFieldFormats(bankName: string, config: BankConfig): void {
  if (config.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email)) {
    throw new ConfigurationError(`Invalid email format for ${bankName}: "${config.email}"`);
  }
  const phone = config.phoneNumber?.replace(/[\s-]/g, '');
  if (config.phoneNumber && phone && !/^\+?\d{10,15}$/.test(phone)) {
    throw new ConfigurationError(
      `Invalid phone number format for ${bankName}: "${config.phoneNumber}". ` +
      `Expected 10-15 digits.`
    );
  }
  if (config.card6Digits && !/^\d{6}$/.test(config.card6Digits)) {
    throw new ConfigurationError(
      `Invalid card6Digits format for ${bankName}: "${config.card6Digits}". Expected 6 digits.`
    );
  }
}

/**
 * Checks that all required credential fields are present for known banks.
 * @param bankName - The bank key to look up in the credential spec map.
 * @param config - The BankConfig to check for required fields.
 */
function validateRequiredCredentials(bankName: string, config: BankConfig): void {
  const spec = credentialSpecs[bankName.toLowerCase()];
  if (!spec) return;
  const missing = spec.required.filter(field => !config[field]);
  if (missing.length > 0) {
    throw new ConfigurationError(`${spec.displayName} requires: ${spec.label}`);
  }
}
