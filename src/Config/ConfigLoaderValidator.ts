/**
 * Top-level config-section validators: Actual Budget, server URL, notifications,
 * spending-watch, and proxy blocks.
 *
 * Bank-specific validation lives in {@link ./BankConfigValidators.js}; both modules
 * are re-exported here so existing importers of `ConfigLoaderValidator.js` keep their
 * import paths unchanged. All functions return Procedure<{ valid: true }> — succeed if
 * OK, fail with an error message.
 */
import type {
IImporterConfig, INotificationConfig, IProxyConfig,
ISpendingWatchRule, Procedure} from '../Types/Index.js';
import { fail, isFail, succeed } from '../Types/Index.js';
import NOTIFICATION_CHANNEL_VALIDATORS from './Validators/NotificationChannelValidators.js';
import { isValidUUID } from './Validators/ValidationResult.js';

export { default as validateBank } from './BankConfigValidators.js';
export { CREDENTIAL_SPECS, type ICredentialSpec } from './BankCredentialSpecs.js';
export { isValidUUID } from './Validators/ValidationResult.js';

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
 *
 * Iterates {@link NOTIFICATION_CHANNEL_VALIDATORS} instead of an if-chain so
 * adding a new channel (e.g., Slack) does not modify this dispatcher.
 *
 * @param config - The INotificationConfig block to validate.
 * @returns Procedure with valid: true on success, or first channel failure.
 */
export function validateNotifications(config: INotificationConfig): Procedure<{ valid: true }> {
  if (!config.telegram && !config.webhook) {
    return fail('Enable at least one notification channel (Telegram or webhook) when notifications are on.');
  }
  for (const channel of NOTIFICATION_CHANNEL_VALIDATORS) {
    if (!channel.applies(config)) continue;
    const result = channel.validate(config);
    if (isFail(result)) return result;
  }
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
