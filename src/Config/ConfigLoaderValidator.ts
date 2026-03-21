/**
 * Validation helpers extracted from ConfigLoader to keep it within the 300-line limit.
 * All functions return Procedure<{ valid: true }> — succeed if OK, fail with error message.
 */
import type {
IBankConfig, IImporterConfig, INotificationConfig, IProxyConfig,
ISpendingWatchRule, Procedure} from '../Types/Index.js';
import { fail, isFail, succeed } from '../Types/Index.js';

// OCP: add new banks by adding entries — no if/else changes needed
interface ICredentialSpec { displayName: string; required: (keyof IBankConfig)[]; label: string }
const CREDENTIAL_SPECS: Record<string, ICredentialSpec> = {
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
 * @returns Procedure with valid: true on success, or failure message.
 */
export function validateActualConfig(config: IImporterConfig): Procedure<{ valid: true }> {
  if (!config.actual.init.password) {
    return fail(
      'ACTUAL_PASSWORD is required (set via environment variable or config.json)'
    );
  }
  if (!config.actual.budget.syncId) {
    return fail(
      'ACTUAL_BUDGET_SYNC_ID is required (set via environment variable or config.json)'
    );
  }
  if (!isValidUUID(config.actual.budget.syncId)) {
    return fail(
      `Invalid ACTUAL_BUDGET_SYNC_ID format. Expected UUID, got: ${config.actual.budget.syncId}`
    );
  }
  return succeed({ valid: true as const });
}

/**
 * Validates that the Actual server URL starts with http:// or https://.
 * @param url - The server URL string to check.
 * @returns Procedure with valid: true on success, or failure message.
 */
export function validateServerUrl(url: string): Procedure<{ valid: true }> {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return fail(
      `Invalid serverURL format. Must start with http:// or https://, got: ${url}`
    );
  }
  return succeed({ valid: true as const });
}

/**
 * Validates notification settings (Telegram and webhook) when notifications are enabled.
 * @param config - The INotificationConfig block to validate.
 * @returns Procedure with valid: true on success, or failure message.
 */
export function validateNotifications(config: INotificationConfig): Procedure<{ valid: true }> {
  if (config.telegram) {
    const telegramResult = validateTelegramConfig(config.telegram);
    if (isFail(telegramResult)) return telegramResult;
  }
  if (config.webhook) {
    const webhookResult = validateWebhookConfig(config.webhook);
    if (isFail(webhookResult)) return webhookResult;
  }
  return succeed({ valid: true as const });
}

/**
 * Validates the Telegram bot token format and presence.
 * @param botToken - The bot token string to validate.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateBotToken(botToken: string): Procedure<{ valid: true }> {
  if (!botToken) return fail('Telegram botToken is required');
  if (!/^\d+:.+$/.test(botToken)) {
    return fail('Invalid botToken format. Expected: "123456789:ABCdef..."');
  }
  return succeed({ valid: true as const });
}

/**
 * Validates Telegram bot token, chat ID, and enum fields.
 * @param telegram - The Telegram notification config to validate.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateTelegramConfig(
  telegram: NonNullable<INotificationConfig['telegram']>
): Procedure<{ valid: true }> {
  const tokenResult = validateBotToken(telegram.botToken);
  if (isFail(tokenResult)) return tokenResult;
  if (!telegram.chatId) return fail('Telegram chatId is required');
  const formatResult = validateEnumField(
    telegram.messageFormat || false,
    ['summary', 'compact', 'ledger', 'emoji'], 'messageFormat'
  );
  if (isFail(formatResult)) return formatResult;
  const showResult = validateEnumField(
    telegram.showTransactions || false,
    ['new', 'all', 'none'], 'showTransactions'
  );
  if (isFail(showResult)) return showResult;
  return succeed({ valid: true as const });
}

/**
 * Validates the spending watch rules array.
 * @param rules - Array of ISpendingWatchRule objects to validate.
 * @returns Procedure with valid: true on success, or failure message.
 */
export function validateSpendingWatch(rules: ISpendingWatchRule[]): Procedure<{ valid: true }> {
  if (!Array.isArray(rules)) {
    return fail('spendingWatch must be an array of rules');
  }
  for (let idx = 0; idx < rules.length; idx++) {
    const ruleResult = validateWatchRule(rules[idx], idx);
    if (isFail(ruleResult)) return ruleResult;
  }
  return succeed({ valid: true as const });
}

/**
 * Validates a single spending watch rule entry.
 * @param rule - The ISpendingWatchRule to check.
 * @param idx - Zero-based index of the rule, used in error messages.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateWatchRule(rule: ISpendingWatchRule, idx: number): Procedure<{ valid: true }> {
  if (!rule.alertFromAmount || rule.alertFromAmount <= 0) {
    return fail(
      `spendingWatch[${String(idx)}]: alertFromAmount is required and must be positive`
    );
  }
  const { numOfDayToCount } = rule;
  if (!numOfDayToCount || !Number.isInteger(numOfDayToCount)
    || numOfDayToCount < 1 || numOfDayToCount > 365) {
    return fail(
      `spendingWatch[${String(idx)}]: numOfDayToCount must be an integer between 1 and 365`
    );
  }
  if (rule.watchPayees !== undefined && !Array.isArray(rule.watchPayees)) {
    return fail(
      `spendingWatch[${String(idx)}]: watchPayees must be an array of strings`
    );
  }
  return succeed({ valid: true as const });
}

/**
 * Validates the webhook URL and format enum.
 * @param webhook - The webhook notification config to validate.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateWebhookConfig(
  webhook: NonNullable<INotificationConfig['webhook']>
): Procedure<{ valid: true }> {
  if (!webhook.url) {
    return fail(
      'Webhook url is required when webhook notifications are configured'
    );
  }
  if (!webhook.url.startsWith('http://') && !webhook.url.startsWith('https://')) {
    return fail(
      `Invalid webhook url format. Must start with http:// or https://, got: ${webhook.url}`
    );
  }
  const formatResult = validateEnumField(
    webhook.format || false, ['slack', 'discord', 'plain'], 'webhook format'
  );
  if (isFail(formatResult)) return formatResult;
  return succeed({ valid: true as const });
}

/**
 * Validates the proxy configuration server URL format.
 * @param proxy - The IProxyConfig to validate.
 * @returns Procedure with valid: true on success, or failure message.
 */
export function validateProxy(proxy: IProxyConfig): Procedure<{ valid: true }> {
  if (!proxy.server) {
    return fail('proxy.server is required when proxy is configured');
  }
  const validPrefixes = ['socks5://', 'socks4://', 'http://', 'https://'];
  if (!validPrefixes.some(prefix => proxy.server.startsWith(prefix))) {
    return fail(
      `Invalid proxy.server format "${proxy.server}". ` +
      'Must start with socks5://, socks4://, http://, or https://'
    );
  }
  return succeed({ valid: true as const });
}

/**
 * Validates that a field value is one of the allowed enum strings.
 * @param value - The field value to check (may be undefined).
 * @param allowed - Array of permitted string values.
 * @param fieldName - Display name of the field used in error messages.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateEnumField(
  value: string | false, allowed: string[], fieldName: string
): Procedure<{ valid: true }> {
  if (value && !allowed.includes(value)) {
    return fail(
      `Invalid ${fieldName} "${value}". Must be one of: ${allowed.join(', ')}`
    );
  }
  return succeed({ valid: true as const });
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
 * @param config - The IBankConfig object to validate.
 * @returns Procedure with valid: true on success, or failure message.
 */
export function validateBank(bankName: string, config: IBankConfig): Procedure<{ valid: true }> {
  const dateResult = validateDateConfig(bankName, config);
  if (isFail(dateResult)) return dateResult;
  const targetsResult = validateTargets(bankName, config.targets);
  if (isFail(targetsResult)) return targetsResult;
  const credResult = validateBankCredentials(bankName, config);
  if (isFail(credResult)) return credResult;
  return succeed({ valid: true as const });
}

/**
 * Validates that only one of startDate or daysBack is set, and their values are in range.
 * @param bankName - Bank name used in error messages.
 * @param config - The bank config containing the date settings.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateDateConfig(bankName: string, config: IBankConfig): Procedure<{ valid: true }> {
  if (config.startDate && config.daysBack) {
    return fail(
      `${bankName}: cannot use both "startDate" and "daysBack". Choose one.`
    );
  }
  if (config.daysBack !== undefined) {
    const daysResult = validateDaysBack(bankName, config.daysBack);
    if (isFail(daysResult)) return daysResult;
  }
  if (config.startDate) {
    const startResult = validateStartDate(bankName, config.startDate);
    if (isFail(startResult)) return startResult;
  }
  return succeed({ valid: true as const });
}

/**
 * Validates that daysBack is an integer between 1 and 30.
 * @param bankName - Bank name used in error messages.
 * @param daysBack - The daysBack value to validate.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateDaysBack(bankName: string, daysBack: number): Procedure<{ valid: true }> {
  if (!Number.isInteger(daysBack) || daysBack < 1 || daysBack > 30) {
    return fail(
      `${bankName}: "daysBack" must be an integer between 1 and 30. Got: ${String(daysBack)}`
    );
  }
  return succeed({ valid: true as const });
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
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateStartDate(
  bankName: string, startDate: string
): Procedure<{ valid: true }> {
  const date = new Date(startDate);
  const dateTimestamp = date.getTime();
  if (Number.isNaN(dateTimestamp)) {
    return fail(`Invalid startDate for ${bankName}: "${startDate}". Use YYYY-MM-DD`);
  }
  if (date > new Date()) {
    return fail(`startDate cannot be in the future for ${bankName}. Got: ${startDate}`);
  }
  if (date < getOneYearAgo()) {
    return fail(`${bankName}: startDate too old (>1 year). Got: ${startDate}`);
  }
  return succeed({ valid: true as const });
}

/**
 * Validates that at least one target is configured and each target is valid.
 * @param bankName - Bank name used in error messages.
 * @param targets - The array of IBankTarget objects to validate.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateTargets(
  bankName: string, targets: IBankConfig['targets']
): Procedure<{ valid: true }> {
  if (!targets || targets.length === 0) {
    return fail(
      `No targets configured for ${bankName}. At least one target is required.`
    );
  }
  for (let idx = 0; idx < targets.length; idx++) {
    const targetResult = validateTarget(bankName, targets[idx], idx);
    if (isFail(targetResult)) return targetResult;
  }
  return succeed({ valid: true as const });
}

/**
 * Validates that a target's actualAccountId is present and is a valid UUID.
 * @param bankName - Bank name used in error messages.
 * @param accountId - The actualAccountId string to validate.
 * @param idx - Zero-based target index used in error messages.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateTargetId(
  bankName: string, accountId: string, idx: number
): Procedure<{ valid: true }> {
  if (!accountId) {
    return fail(`Missing actualAccountId for ${bankName} target ${String(idx)}`);
  }
  if (!isValidUUID(accountId)) {
    return fail(
      `Invalid actualAccountId format for ${bankName} target ${String(idx)}.\n` +
      '  Expected: UUID format (e.g., "12345678-1234-1234-1234-123456789abc")\n' +
      `  Got: "${accountId}"`
    );
  }
  return succeed({ valid: true as const });
}

/**
 * Validates a single IBankTarget: ID, accounts field, and reconcile type.
 * @param bankName - Bank name used in error messages.
 * @param target - The target object to validate.
 * @param target.actualAccountId - UUID of the Actual account.
 * @param target.accounts - Account filter: 'all' or array of account numbers.
 * @param target.reconcile - Whether reconciliation is enabled.
 * @param idx - Zero-based target index used in error messages.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateTarget(
  bankName: string,
  target: { actualAccountId: string; accounts: string[] | 'all'; reconcile: boolean },
  idx: number
): Procedure<{ valid: true }> {
  const idResult = validateTargetId(bankName, target.actualAccountId, idx);
  if (isFail(idResult)) return idResult;
  const { accounts } = target;
  if (accounts !== 'all' && (!Array.isArray(accounts) || accounts.length === 0)) {
    return fail(`Invalid accounts for ${bankName} target ${String(idx)}. Must be "all" or array.`);
  }
  if (typeof target.reconcile !== 'boolean') {
    return fail(`Invalid reconcile for ${bankName} target ${String(idx)}. Must be boolean.`);
  }
  return succeed({ valid: true as const });
}

/**
 * Validates credential field formats and required credential presence for a bank.
 * @param bankName - The bank key used to look up the credential spec.
 * @param config - The IBankConfig whose credentials to validate.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateBankCredentials(
  bankName: string, config: IBankConfig
): Procedure<{ valid: true }> {
  const formatsResult = validateFieldFormats(bankName, config);
  if (isFail(formatsResult)) return formatsResult;
  const requiredResult = validateRequiredCredentials(bankName, config);
  if (isFail(requiredResult)) return requiredResult;
  return succeed({ valid: true as const });
}

/**
 * Validates email, phone number, and card6Digits format for a bank config.
 * @param bankName - Bank name used in error messages.
 * @param config - The IBankConfig whose field formats to validate.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateFieldFormats(
  bankName: string, config: IBankConfig
): Procedure<{ valid: true }> {
  if (config.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email)) {
    return fail(`Invalid email format for ${bankName}: "${config.email}"`);
  }
  const phone = config.phoneNumber?.replaceAll(/[\s-]/g, '');
  if (config.phoneNumber && phone && !/^\+?\d{10,15}$/.test(phone)) {
    return fail(
      `Invalid phone number format for ${bankName}: "${config.phoneNumber}". ` +
      'Expected 10-15 digits.'
    );
  }
  if (config.card6Digits && !/^\d{6}$/.test(config.card6Digits)) {
    return fail(
      `Invalid card6Digits format for ${bankName}: "${config.card6Digits}". Expected 6 digits.`
    );
  }
  return succeed({ valid: true as const });
}

/**
 * Checks that all required credential fields are present for known banks.
 * @param bankName - The bank key to look up in the credential spec map.
 * @param config - The IBankConfig to check for required fields.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateRequiredCredentials(
  bankName: string, config: IBankConfig
): Procedure<{ valid: true }> {
  const key = bankName.toLowerCase();
  if (!Object.hasOwn(CREDENTIAL_SPECS, key)) return succeed({ valid: true as const });
  const spec = CREDENTIAL_SPECS[key];
  const missing = spec.required.filter(field => !config[field]);
  if (missing.length > 0) {
    return fail(`${spec.displayName} requires: ${spec.label}`);
  }
  return succeed({ valid: true as const });
}
